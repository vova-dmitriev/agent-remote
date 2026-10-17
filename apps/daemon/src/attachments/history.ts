import { ClaudeContentType } from '../domain/claude.js';
import {
  MessageRole,
  AttachmentKind,
  ATTACHMENT_TTL_MS,
  type HistoryMessage,
  type Session,
  attachmentsSchema,
} from '../../../../packages/protocol/src/index.js';
import { type PreparedAttachment } from './types.js';
import { attachmentPrompt, codexAttachmentInput } from './input.js';

interface Entry {
  text: string;
  sent: string[];
  paths: string[];
  attachments: PreparedAttachment['descriptor'][];
  expiresAt: number;
}
export class AttachmentHistory {
  private entries = new Map<string, Entry>();
  remember(session: Session, text: string, attachments: readonly PreparedAttachment[]) {
    const key = JSON.stringify([session.id, attachments.map((item) => item.path)]);

    const codexText = codexAttachmentInput(text, attachments)
      .filter((part) => part.type === ClaudeContentType.Text)
      .map((part) => part.text)
      .join('\n');

    this.entries.delete(key);

    this.entries.set(key, {
      text,
      sent: [attachmentPrompt(text, attachments), codexText],
      paths: attachments.map((item) => item.path),
      attachments: attachments.map((item) => structuredClone(item.descriptor)),
      expiresAt: Date.now() + ATTACHMENT_TTL_MS,
    });

    while (this.entries.size > 200) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
  snapshot() {
    const entries = [...this.entries].filter(([, value]) => value.expiresAt > Date.now());

    while (Buffer.byteLength(JSON.stringify(entries)) > 16 * 1024 * 1024) {
      entries.shift();
    }

    return entries;
  }
  load(value: unknown) {
    if (!Array.isArray(value)) {
      return;
    }

    for (const entry of value.slice(-200)) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        continue;
      }

      const [key, item] = entry;

      if (typeof key !== 'string' || key.length > 32768 || !item || typeof item !== 'object') {
        continue;
      }

      if (
        typeof item.text !== 'string' ||
        Buffer.byteLength(item.text) > 65536 ||
        !Array.isArray(item.sent) ||
        !item.sent.every((text: unknown) => typeof text === 'string' && Buffer.byteLength(text) <= 73728) ||
        !Array.isArray(item.paths) ||
        !item.paths.every((path: unknown) => typeof path === 'string' && path.length <= 4096) ||
        typeof item.expiresAt !== 'number' ||
        item.expiresAt <= Date.now()
      ) {
        continue;
      }

      const descriptors = attachmentsSchema.safeParse(item.attachments);

      if (!descriptors.success) {
        continue;
      }

      this.entries.set(key, { ...item, attachments: descriptors.data } as Entry);
    }
  }
  restore(session: Session, message: HistoryMessage, paths: readonly string[] = []): HistoryMessage {
    if (message.role !== MessageRole.User) {
      return message;
    }

    const prefix = JSON.stringify([session.id]).slice(0, -1) + ',';

    for (const [key, value] of [...this.entries].reverse()) {
      if (value.expiresAt <= Date.now()) {
        this.entries.delete(key);
        continue;
      }

      if (!key.startsWith(prefix) || !value.sent.includes(message.text)) {
        continue;
      }

      // Native images require exact provider path provenance. Plain text alone is ambiguous.
      const referenced = value.sent[0] === message.text && message.text !== value.text;

      const imagePaths = value.paths.filter(
        (_, index) => value.attachments[index]?.kind === AttachmentKind.Image,
      );

      if (!referenced && imagePaths.some((path) => !paths.includes(path))) {
        continue;
      }

      if (!message.text && !paths.length) {
        continue;
      }

      if (paths.some((path) => !value.paths.includes(path))) {
        continue;
      }

      return { ...message, text: value.text, attachments: structuredClone(value.attachments) };
    }

    return message;
  }
}
