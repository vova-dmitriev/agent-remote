import {
  ATTACHMENT_TTL_MS,
  type AttachmentDescriptor,
  attachmentSchema,
  attachmentsSchema,
  CodedError,
  ErrorCode,
  errorCode,
  hasErrorCode,
  type HistoryMessage,
  HttpStatus,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MessageRole,
  type Session,
} from '@protocol';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, rm, writeFile, readFile, rename, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validateRelayUrl } from '../config.js';
import { AttachmentErrorCode, RETRYABLE_ATTACHMENT_ERRORS, ATTACHMENT_VALIDATION_ERRORS } from './errors.js';
import {
  ATTACHMENT_MAINTENANCE_INTERVAL_MS,
  ATTACHMENT_HISTORY_MAX_BYTES,
  ATTACHMENT_DISCOVERY_MAX_ENTRIES,
  ATTACHMENT_MAX_PREPARED_FILES,
  ATTACHMENT_MAX_PENDING_EXPORTS,
  ATTACHMENT_LOCAL_QUOTA_BYTES,
  ATTACHMENT_EXPORT_WINDOW_MS,
  ATTACHMENT_EXPORTS_PER_WINDOW,
  ATTACHMENT_EXPORT_RESPONSE_MAX_BYTES,
  ATTACHMENT_EXPORT_EXPIRY_MARGIN_MS,
  ATTACHMENT_MAX_EXPORTED_DESCRIPTORS,
  ATTACHMENT_REQUEST_TIMEOUT_MS,
} from './limits.js';
import { AttachmentHistory } from './content/history.js';
import { nativeImageMime } from './content/image-content.js';
import { boundedBody, nativeFile } from './relay/io.js';
import { type NativeMedia, type PreparedAttachment } from './types.js';
import type { LocalAttachmentBackend } from './relay/local-backend.js';
import { RelayAttachmentMirror } from './relay/relay-mirror.js';
import { logDebug } from '../diagnostics/log.js';

export type { NativeMedia, PreparedAttachment } from './types.js';
interface Options {
  relayUrl?: string;
  deviceToken?: string;
  directory: string;
  fetch?: typeof fetch;
  current?: (session: Session) => boolean;
  local?: LocalAttachmentBackend;
}
export class AttachmentService {
  private readonly history = new AttachmentHistory();
  private readonly fetcher: typeof fetch;
  private readonly mirrors: RelayAttachmentMirror;
  private root?: Promise<string>;
  private closed = false;
  private files = new Map<string, { size: number; expiresAt: number }>();
  private exported = new Map<
    string,
    { descriptor: AttachmentDescriptor; expiresAt: number; source?: { messageId: string; position: string } }
  >();
  private exporting = new Map<string, Promise<AttachmentDescriptor>>();
  private retrying?: Promise<void>;
  private exportWindow = { since: Date.now(), used: 0 };
  private metadataQueue: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, { session: Session; message: HistoryMessage; media: NativeMedia[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly maintenance: ReturnType<typeof setInterval>;
  constructor(private options: Options) {
    if (options.relayUrl) {
      validateRelayUrl(options.relayUrl);
    }

    this.fetcher = options.fetch ?? fetch;

    this.mirrors = new RelayAttachmentMirror(
      options.local,
      !!(options.relayUrl && options.deviceToken),
      (session, id, init) => this.request(session, id, init),
    );

    this.maintenance = setInterval(() => {
      void this.pruneExpired().catch((error: unknown) => logDebug('attachments/service', error));
    }, ATTACHMENT_MAINTENANCE_INTERVAL_MS);

    this.maintenance.unref();
  }
  async ready() {
    await this.directory();
  }
  prepare(session: Session, attachments: AttachmentDescriptor[]): Promise<PreparedAttachment[]> {
    const parsed = attachmentsSchema.parse(attachments);
    const run = this.queue.then(() => this.download(session, parsed));

    this.queue = run.catch((error: unknown) => logDebug('attachments/service', error));

    return run;
  }
  private async directory() {
    if (this.closed) {
      throw new CodedError(AttachmentErrorCode.Unavailable);
    }

    this.root ??= (async () => {
      const parent = join(this.options.directory, 'attachments');

      await mkdir(parent, { recursive: true, mode: 0o700 });
      const info = await lstat(parent);

      if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
        throw new CodedError(AttachmentErrorCode.Unavailable);
      }

      await chmod(parent, 0o700);

      try {
        const metadata = join(parent, 'history.json');
        const saved = await lstat(metadata);

        if (
          saved.isFile() &&
          !saved.isSymbolicLink() &&
          saved.size <= ATTACHMENT_HISTORY_MAX_BYTES &&
          (!process.getuid || saved.uid === process.getuid())
        ) {
          this.history.load(JSON.parse(await readFile(metadata, 'utf8')));
        }
      } catch {} // ignore: first launch has no attachment history.

      for (const entry of (await readdir(parent, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isDirectory() && (entry.name === 'files' || /^private-[A-Za-z0-9]+$/u.test(entry.name)),
        )
        .slice(0, ATTACHMENT_DISCOVERY_MAX_ENTRIES)) {
        const directory = join(parent, entry.name),
          info = await lstat(directory);

        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          (process.getuid && info.uid !== process.getuid())
        ) {
          continue;
        }

        for (const name of (await readdir(directory)).slice(0, ATTACHMENT_DISCOVERY_MAX_ENTRIES)) {
          if (!/^[a-f0-9-]{36}(?:\.[a-z0-9]{1,8})?$/u.test(name)) {
            continue;
          }

          const path = join(directory, name),
            saved = await lstat(path);

          if (
            saved.isFile() &&
            !saved.isSymbolicLink() &&
            (!process.getuid || saved.uid === process.getuid())
          ) {
            this.files.set(path, { size: saved.size, expiresAt: saved.mtimeMs + ATTACHMENT_TTL_MS });
          }
        }
      }

      await this.prune(0);
      const root = join(parent, 'files');

      await mkdir(root, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      });

      const rootInfo = await lstat(root);

      if (
        !rootInfo.isDirectory() ||
        rootInfo.isSymbolicLink() ||
        (process.getuid && rootInfo.uid !== process.getuid())
      ) {
        throw new CodedError(AttachmentErrorCode.Unavailable);
      }

      await chmod(root, 0o700);

      return root;
    })();

    return this.root;
  }
  private async download(session: Session, attachments: AttachmentDescriptor[]) {
    const prepared: PreparedAttachment[] = [];

    try {
      const root = await this.directory();

      await this.prune(attachments.reduce((sum, item) => sum + item.byteLength, 0));

      if (this.files.size + attachments.length > ATTACHMENT_MAX_PREPARED_FILES) {
        throw new CodedError(AttachmentErrorCode.Quota);
      }

      for (const descriptor of attachments) {
        const response = await this.request(session, descriptor.id);
        const bytes = await boundedBody(response);

        if (
          bytes.length !== descriptor.byteLength ||
          createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256
        ) {
          throw new CodedError(AttachmentErrorCode.IntegrityFailed);
        }

        await this.mirrors.prepare(session, descriptor, bytes);

        if (this.closed) {
          throw new CodedError(AttachmentErrorCode.Unavailable);
        }

        const extensions: Record<string, string> = {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/webp': '.webp',
          'image/gif': '.gif',
          'application/pdf': '.pdf',
          'text/plain': '.txt',
          'application/json': '.json',
        };

        const path = join(root, randomUUID() + (extensions[descriptor.mimeType] ?? '.bin'));

        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        this.files.set(path, { size: bytes.length, expiresAt: Date.now() + ATTACHMENT_TTL_MS });
        prepared.push({ descriptor: structuredClone(descriptor), path });
      }

      return prepared;
    } catch (error) {
      for (const item of prepared) {
        this.files.delete(item.path);
        await rm(item.path, { force: true });
      }

      throw error;
    }
  }
  async remember(session: Session, text: string, attachments: readonly PreparedAttachment[]) {
    await this.directory();
    this.history.remember(session, text, this.mirrors.history(session, attachments));

    const save = this.metadataQueue.then(async () => {
      const path = join(this.options.directory, 'attachments', 'history.json');
      const temporary = path + '.' + randomUUID();

      await writeFile(temporary, JSON.stringify(this.history.snapshot()), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    });

    this.metadataQueue = save.catch((error: unknown) => logDebug('attachments/service', error));
    await save;
  }
  restore(session: Session, message: HistoryMessage, paths: readonly string[] = []) {
    const restored = this.history.restore(session, message, paths);

    if (restored.attachments?.length || restored.role !== MessageRole.User) {
      return restored;
    }

    let removed = false;

    const lines = restored.text.split('\n').filter((line) => {
      if (!line.startsWith('Attached local file: ')) {
        return true;
      }

      try {
        const path: unknown = JSON.parse(line.slice('Attached local file: '.length));

        if (typeof path !== 'string') {
          return true;
        }

        const local = relative(join(this.options.directory, 'attachments'), path);

        if (/^(?:files|private-[A-Za-z0-9]+)\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,8})?$/u.test(local)) {
          removed = true;

          return false;
        }
      } catch {} // ignore: ordinary user text remains untouched.

      return true;
    });

    return removed ? { ...restored, text: lines.join('\n').trimEnd() } : restored;
  }
  async normalize(
    session: Session,
    message: HistoryMessage,
    media: NativeMedia[] = [],
    current: () => boolean = () => true,
  ): Promise<HistoryMessage> {
    await this.directory();

    const restored = this.restore(
      session,
      message,
      media.flatMap((item) => (item.path ? [item.path] : [])),
    );

    if (restored.attachments?.length) {
      return restored;
    }

    const attachments: AttachmentDescriptor[] = [];
    let text = restored.text;

    let total = 0,
      retry = false;

    for (const [index, item] of media.slice(0, MAX_ATTACHMENTS).entries()) {
      if (!current()) {
        return restored;
      }

      try {
        const descriptor = await this.export(
          session,
          `${message.id}:${index}`,
          item,
          message.historyCursor?.startsWith('position:')
            ? { messageId: message.id, position: message.historyCursor }
            : undefined,
        );

        if (total + descriptor.byteLength > MAX_MESSAGE_ATTACHMENT_BYTES) {
          break;
        }

        total += descriptor.byteLength;
        attachments.push(descriptor);

        if (restored.role === MessageRole.User && item.placeholder) {
          const position = text.lastIndexOf(item.placeholder);

          if (position !== -1) {
            text = (text.slice(0, position) + text.slice(position + item.placeholder.length)).trimEnd();
          }
        }
      } catch (error) {
        retry ||= RETRYABLE_ATTACHMENT_ERRORS.has(errorCode(error) ?? '');
      }
    }

    const key = JSON.stringify([session.id, message.id]);

    if (retry) {
      this.pending.set(key, { session: structuredClone(session), message, media });

      while (
        this.pending.size > ATTACHMENT_MAX_PENDING_EXPORTS ||
        [...this.pending.values()].reduce(
          (sum, entry) => sum + entry.media.reduce((bytes, value) => bytes + (value.bytes?.length ?? 0), 0),
          0,
        ) > ATTACHMENT_LOCAL_QUOTA_BYTES
      ) {
        this.pending.delete(this.pending.keys().next().value!);
      }
    } else {
      this.pending.delete(key);
    }

    return attachments.length ? { ...restored, text, attachments } : restored;
  }
  retryExports(publish: (session: Session, message: HistoryMessage) => void): Promise<void> {
    if (this.retrying) {
      return this.retrying;
    }

    const run = (async () => {
      for (const item of [...this.pending.values()]) {
        if (this.options.current && !this.options.current(item.session)) {
          this.pending.delete(JSON.stringify([item.session.id, item.message.id]));
          continue;
        }

        const message = await this.normalize(item.session, item.message, item.media);

        if (!this.closed && message.attachments?.length) {
          publish(item.session, message);
        }
      }
    })();

    this.retrying = run;

    void run
      .finally(() => {
        delete this.retrying;
      })
      .catch((error: unknown) => logDebug('attachments/service', error));

    return run;
  }
  async export(
    session: Session,
    sourceId: string,
    media: NativeMedia,
    source?: { messageId: string; position: string },
  ): Promise<AttachmentDescriptor> {
    if (this.closed) {
      throw new CodedError(AttachmentErrorCode.Unavailable);
    }

    if (this.options.current && !this.options.current(session)) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    const bytes = media.bytes ?? (media.path ? await nativeFile(media.path) : undefined);

    if (!bytes?.length || bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new CodedError(AttachmentErrorCode.SourceUnavailable);
    }

    if (media.path) {
      const mimeType = nativeImageMime(bytes);

      if (!mimeType) {
        throw new CodedError(AttachmentErrorCode.SourceUnavailable);
      }

      media = { ...media, mimeType };
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    const key = JSON.stringify([session.id, sourceId, digest, media.name, media.mimeType]);
    const known = this.exported.get(key);

    if (
      known &&
      known.expiresAt > Date.now() &&
      (!source || JSON.stringify(source) === JSON.stringify(known.source))
    ) {
      try {
        await this.request(session, known.descriptor.id, { method: 'HEAD' }, !!this.options.relayUrl);

        return known.descriptor;
      } catch (error) {
        if (!hasErrorCode(error, AttachmentErrorCode.Unavailable)) {
          throw error;
        }

        this.exported.delete(key);
      }
    }

    const pending = this.exporting.get(key);

    if (pending) {
      return pending;
    }

    const run = this.upload(session, key, media, bytes, digest, source);

    this.exporting.set(key, run);

    try {
      return await run;
    } finally {
      this.exporting.delete(key);
    }
  }
  private async upload(
    session: Session,
    key: string,
    media: NativeMedia,
    bytes: Buffer,
    digest: string,
    source?: { messageId: string; position: string },
  ): Promise<AttachmentDescriptor> {
    if (Date.now() - this.exportWindow.since >= ATTACHMENT_EXPORT_WINDOW_MS) {
      this.exportWindow = { since: Date.now(), used: 0 };
    }

    if (this.exportWindow.used >= ATTACHMENT_EXPORTS_PER_WINDOW) {
      throw new CodedError(AttachmentErrorCode.RateLimited);
    }

    const budget = this.exportWindow;

    budget.used++;

    const hash = createHash('sha256')
      .update(key + ':' + Math.floor(Date.now() / ATTACHMENT_TTL_MS))
      .digest('hex');

    const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

    if (this.options.current && !this.options.current(session)) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    const response = await this.request(session, undefined, {
      method: 'POST',
      headers: {
        ...(source ? { 'x-source-message-id': source.messageId, 'x-source-position': source.position } : {}),
        'x-upload-id': uuid,
        'x-file-name': encodeURIComponent(media.name),
        'x-session-generation': session.generation,
        'Content-Type': media.mimeType,
      },
      body: new Uint8Array(bytes),
    });

    if (response.headers.get('x-attachment-cache-hit') === '1') {
      budget.used = Math.max(0, budget.used - 1);
    }

    let body: Buffer;

    try {
      body = await boundedBody(response, ATTACHMENT_EXPORT_RESPONSE_MAX_BYTES);
    } catch (error) {
      if (ATTACHMENT_VALIDATION_ERRORS.has(errorCode(error) ?? '')) {
        throw error;
      }

      throw new CodedError(AttachmentErrorCode.TransferFailed);
    }

    const value = attachmentSchema.parse(JSON.parse(body.toString('utf8')));

    if (value.sha256 !== digest || value.byteLength !== bytes.length) {
      throw new CodedError(AttachmentErrorCode.IntegrityFailed);
    }

    await this.options.local?.importDescriptor(session, value, bytes).catch(() => {}); // ignore: a bounded relay export remains usable when the optional local cache is full.

    this.exported.set(key, {
      descriptor: value,
      expiresAt: Date.now() + ATTACHMENT_TTL_MS - ATTACHMENT_EXPORT_EXPIRY_MARGIN_MS,
      ...(source ? { source } : {}),
    });

    if (this.exported.size > ATTACHMENT_MAX_EXPORTED_DESCRIPTORS) {
      this.exported.delete(this.exported.keys().next().value!);
    }

    return value;
  }
  private async request(session: Session, id?: string, init: RequestInit = {}, relayOnly = false) {
    if (this.closed) {
      throw new CodedError(AttachmentErrorCode.Unavailable);
    }

    if (this.options.local && !relayOnly && (id || !this.options.relayUrl)) {
      const local = await this.options.local.request(session, id, init);

      if (local) {
        return local;
      }
    }

    if (!this.options.relayUrl || !this.options.deviceToken) {
      throw new CodedError(AttachmentErrorCode.Unavailable);
    }

    const url = new URL(
      `/device/sessions/${encodeURIComponent(session.id)}/attachments${id ? '/' + encodeURIComponent(id) : ''}`,
      this.options.relayUrl,
    );

    let response: Response;

    try {
      response = await this.fetcher(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.options.deviceToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(ATTACHMENT_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CodedError(AttachmentErrorCode.TransferFailed);
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new CodedError(
        response.status === HttpStatus.NotFound || response.status === HttpStatus.Gone
          ? AttachmentErrorCode.Unavailable
          : AttachmentErrorCode.TransferFailed,
      );
    }

    if (this.options.current && !this.options.current(session)) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    return response;
  }
  pruneExpired(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }

    const run = this.queue.then(async () => {
      if (this.root) {
        await this.root;
        await this.prune(0);
      }
    });

    this.queue = run.catch((error: unknown) => logDebug('attachments/service', error));

    return run;
  }
  private async prune(required: number) {
    let total = [...this.files.values()].reduce((sum, item) => sum + item.size, 0);

    for (const [path, entry] of this.files) {
      if (entry.expiresAt > Date.now()) {
        continue;
      }

      await rm(path, { force: true });
      this.files.delete(path);
      total -= entry.size;
    }

    if (total + required > ATTACHMENT_LOCAL_QUOTA_BYTES) {
      throw new CodedError(AttachmentErrorCode.Quota);
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.maintenance);
    await this.queue;
    await this.metadataQueue;
    await this.retrying?.catch((error: unknown) => logDebug('attachments/service', error));
    // Prepared files remain readable by native turns until their bounded retention expires.
    this.pending.clear();
    this.files.clear();
    this.exported.clear();
    this.mirrors.close();
  }
}
