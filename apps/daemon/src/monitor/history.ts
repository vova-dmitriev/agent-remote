import { ErrorCode } from '../../../../packages/protocol/src/index.js';
import { type NativeMedia } from '../attachments/types.js';
import { type HistoryMessage, type HistoryRead } from '../../../../packages/protocol/src/index.js';
import { TranscriptActivity } from '../code/transcript-activity.js';
import { TranscriptPages } from '../code/transcript-pages.js';
import { TranscriptReader } from '../code/transcript-reader.js';

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
  private sources = new Map<
    string,
    {
      generation: string;
      path: string;
      claudeSessionId: string | undefined;
      reader: TranscriptReader;
      pages: TranscriptPages;
      activity: TranscriptActivity;
    }
  >();
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
    });

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
      throw new Error(ErrorCode.SESSION_UNAVAILABLE);
    }

    const page = await source.pages.page(request);

    if (this.sources.get(request.sessionId) !== source) {
      throw new Error(ErrorCode.STALE_SESSION);
    }

    return page;
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
