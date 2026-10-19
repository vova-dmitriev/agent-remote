import { CodedError, ErrorCode, HistoryDirection, type HistoryMessage, type HistoryRead } from '@protocol';
import { type NativeMedia } from '../attachments/types.js';
import { type BackfilledSubagent } from '../activity/subagents.js';
import { TranscriptActivity } from '../code/transcript-activity.js';
import { TranscriptPages } from '../code/transcript/transcript-pages.js';
import { TranscriptReader } from '../code/transcript/transcript-reader.js';
import {
  listSubagentFiles,
  subagentDirectory,
  subagentTranscriptPath,
} from '../code/subagents/subagent-files.js';

/** Subagent transcripts kept open per session generation; each has its own page cursors. */
const SUBAGENT_PAGE_SOURCES = 8;
/** Minimum time between two scans of one session's `subagents` directory; views poll more often. */
const SUBAGENT_RESCAN_INTERVAL_MS = 5_000;

/** The session's subagent list: the only ids whose transcripts may be read, and where backfill lands. */
export interface SubagentListing {
  ids(sessionId: string, generation: string): readonly string[];
  merge(sessionId: string, generation: string, found: BackfilledSubagent[]): void;
}
interface Source {
  generation: string;
  path: string;
  claudeSessionId: string | undefined;
  reader: TranscriptReader;
  pages: TranscriptPages;
  activity: TranscriptActivity;
  agents: Map<string, { directory: string; pages: TranscriptPages }>;
  backfill?: Promise<void> | undefined;
  scannedAt?: number | undefined;
}

export class MessageTracker {
  private seen = new Map<string, string>();
  accept(message: HistoryMessage) {
    const fingerprint = JSON.stringify([message.role, message.text, message.attachments]);

    if (this.seen.get(message.id) === fingerprint) {
      return false;
    }

    this.seen.delete(message.id);
    this.seen.set(message.id, fingerprint);

    if (this.seen.size > 10000) {
      this.seen.delete(this.seen.keys().next().value!);
    }

    return true;
  }
}
export class TranscriptSources {
  private sources = new Map<string, Source>();
  constructor(
    private allowedRoot: string,
    private transform?: (
      sessionId: string,
      generation: string,
      message: HistoryMessage,
      media: NativeMedia[],
    ) => Promise<HistoryMessage>,
    private onActivity?: (sessionId: string, generation: string, time: number) => void,
    private initialWindow = 100,
    private subagents?: SubagentListing,
  ) {}
  open(sessionId: string, generation: string, path: string, claudeSessionId?: string) {
    const current = this.sources.get(sessionId);

    if (
      current?.generation === generation &&
      current.path === path &&
      current.claudeSessionId === claudeSessionId
    ) {
      return current.reader;
    }

    const reader = new TranscriptReader({
      path,
      initialWindow: this.initialWindow,
      ...(this.initialWindow === 0 ? { maxReadBytes: 32 * 1024 * 1024 } : {}),
      ...(this.transform
        ? {
            withPosition: true,
            transform: async (message: HistoryMessage, media: NativeMedia[]) => {
              const normalized = await this.transform!(sessionId, generation, message, media);
              const { historyCursor: _position, ...liveMessage } = normalized;

              return liveMessage;
            },
          }
        : {}),
      allowedRoot: this.allowedRoot,
      ...(claudeSessionId ? { sessionId: claudeSessionId } : {}),
    });

    this.sources.set(sessionId, {
      generation,
      path,
      claudeSessionId,
      reader,
      pages: new TranscriptPages({
        path,
        allowedRoot: this.allowedRoot,
        ...(claudeSessionId ? { sessionId: claudeSessionId } : {}),
        ...(this.transform
          ? { transform: (message, media) => this.transform!(sessionId, generation, message, media) }
          : {}),
      }),
      activity: new TranscriptActivity(path, this.allowedRoot, claudeSessionId),
      agents: new Map(),
    });

    // First observation or restore: list children that started before this process saw the session.
    void this.refreshSubagents(sessionId);

    if (this.initialWindow === 0) {
      void reader.readNext().catch(() => {});
    }

    return reader;
  }
  has(id: string) {
    return this.sources.has(id);
  }
  async page(request: HistoryRead) {
    const source = this.sources.get(request.sessionId);

    if (!source || source.generation !== request.generation) {
      throw new CodedError(ErrorCode.SESSION_UNAVAILABLE);
    }

    const pages = request.agentId
      ? await this.subagentPages(request.sessionId, source, request.agentId, request.direction)
      : source.pages;

    if (!request.agentId && request.direction === HistoryDirection.Latest) {
      // Opening the session (and its subagent list) re-lists children without delaying its history.
      void this.refreshSubagents(request.sessionId);
    }

    const page = await pages.page(request);

    if (this.sources.get(request.sessionId) !== source) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    return page;
  }
  /**
   * Re-list the session's subagent files. Concurrent callers share one directory scan, and a scan that
   * finished within the rescan interval stands for the next one.
   */
  refreshSubagents(sessionId: string): Promise<void> {
    const source = this.sources.get(sessionId);

    if (!source?.claudeSessionId || !this.subagents) {
      return Promise.resolve();
    }

    if (source.backfill) {
      return source.backfill;
    }

    if (source.scannedAt !== undefined && Date.now() - source.scannedAt < SUBAGENT_RESCAN_INTERVAL_MS) {
      return Promise.resolve();
    }

    const listing = this.subagents;

    source.backfill = (async () => {
      try {
        const directory = await subagentDirectory(source.path, source.claudeSessionId!, this.allowedRoot);
        const found = directory ? await listSubagentFiles(directory) : [];

        if (this.sources.get(sessionId) === source) {
          listing.merge(sessionId, source.generation, found);
        }
      } catch {
        /* An unreadable subagent directory leaves the hook-observed list unchanged. */
      } finally {
        source.scannedAt = Date.now();
        source.backfill = undefined;
      }
    })();

    return source.backfill;
  }
  /** Pages of one listed child's own transcript inside the owning session's `subagents` directory. */
  private async subagentPages(
    sessionId: string,
    source: Source,
    agentId: string,
    direction: HistoryRead['direction'],
  ) {
    const claudeSessionId = source.claudeSessionId;

    if (!this.subagents || !claudeSessionId) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    const listed = () => this.subagents!.ids(sessionId, source.generation).includes(agentId);

    if (direction === HistoryDirection.Latest || !listed()) {
      await this.refreshSubagents(sessionId);
    }

    if (this.sources.get(sessionId) !== source) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    if (!listed()) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    // Every read re-checks the directory against the Claude root; a cached reader never outlives it.
    const directory = await subagentDirectory(source.path, claudeSessionId, this.allowedRoot);

    if (!directory) {
      throw new CodedError(ErrorCode.TRANSCRIPT_UNAVAILABLE);
    }

    const cached = source.agents.get(agentId);

    if (cached?.directory === directory) {
      return cached.pages;
    }

    const pages = new TranscriptPages({
      path: subagentTranscriptPath(directory, agentId),
      allowedRoot: directory,
      sessionId: claudeSessionId,
      includeTools: true,
      refuseSymlinks: true,
    });

    source.agents.delete(agentId);
    source.agents.set(agentId, { directory, pages });

    if (source.agents.size > SUBAGENT_PAGE_SOURCES) {
      source.agents.delete(source.agents.keys().next().value!);
    }

    return pages;
  }
  async refreshActivity() {
    if (!this.onActivity) {
      return;
    }

    for (const [id, source] of this.sources) {
      try {
        const time = await source.activity.read();

        if (time && this.sources.get(id) === source) {
          this.onActivity(id, source.generation, time);
        }
      } catch {
        /* A failed metadata read does not discard the history reader. */
      }
    }
  }
  *entries(): IterableIterator<[string, TranscriptReader]> {
    for (const [id, source] of this.sources) {
      yield [id, source.reader];
    }
  }
  delete(id: string, expectedReader?: TranscriptReader): boolean {
    if (expectedReader && this.sources.get(id)?.reader !== expectedReader) {
      return false;
    }

    return this.sources.delete(id);
  }
}
