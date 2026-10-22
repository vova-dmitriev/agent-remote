import {
  HistoryCursorPrefix,
  HistoryDirection,
  FrameType,
  type HistoryPageDirection,
  type ServerFrame,
} from '@protocol';
import { HistoryPageSkip, type ApplicationOperations, type TransportHandlers } from '@/shared/api';
import {
  HistoryStream,
  HistoryWindow,
  ReadingPositions,
  aroundQuery,
  loadSessionHistory,
  restoreHistoryWindow,
} from '@/entities/session';
import type { ExtensionConnection } from '../connection.js';
import { requestHistory, requestMessages } from './request.js';

export class ExtensionHistory {
  private reading: ReadingPositions;
  private window = new HistoryWindow();
  private stream = new HistoryStream();
  private selectedId: string | null = null;
  private deviceId: string | null = null;
  private epoch = 0;
  private generations = new Map<string, string>();
  private stopped = false;
  private restore = false;

  constructor(
    private connection: ExtensionConnection,
    operations: ApplicationOperations,
    private handlers: TransportHandlers,
  ) {
    this.reading = new ReadingPositions(operations);
  }

  get selection() {
    return this.epoch;
  }
  get selected() {
    return this.selectedId;
  }
  get device() {
    return this.deviceId;
  }

  reconnect() {
    this.restore = true;
    ++this.epoch;
    this.window = new HistoryWindow();
  }

  select(deviceId: string, sessionId: string | null, flush = true) {
    if (flush) {
      this.reading.flush();
    }

    ++this.epoch;
    this.deviceId = deviceId;
    this.selectedId = sessionId;
    this.window = new HistoryWindow();
  }

  observe(frame: Extract<ServerFrame, { type: typeof FrameType.Snapshot }>) {
    const previousGeneration = this.selectedId ? this.generations.get(this.selectedId) : undefined;

    this.generations = new Map(frame.snapshot.sessions.map((session) => [session.id, session.generation]));

    const generationChanged =
      this.selectedId &&
      previousGeneration !== undefined &&
      previousGeneration !== this.generations.get(this.selectedId);

    const streamChanged = this.stream.changed(frame);

    const restore = this.restore;

    this.restore = false;

    if ((restore || generationChanged || streamChanged) && this.selectedId) {
      const selected = this.selectedId;
      const epoch = ++this.epoch;

      this.window = new HistoryWindow();

      void restoreHistoryWindow(
        selected,
        this.history(selected),
        () => this.current(selected, epoch),
        this.handlers,
      );
    }
  }

  private current = (sessionId: string, epoch: number) =>
    !this.stopped && sessionId === this.selectedId && epoch === this.epoch;

  /** Latest reloads the newest page, or the window `around` names, instead of the saved reading position. */
  history(sessionId: string, latest = false, around = '') {
    if (latest) {
      ++this.epoch;
      this.window = new HistoryWindow();
    }

    const epoch = this.epoch;
    const generation = this.generations.get(sessionId);
    const current = () => this.current(sessionId, epoch);

    if (!generation) {
      return Promise.resolve(null);
    }

    return loadSessionHistory(
      sessionId,
      (path, observe) => requestHistory(this.connection, sessionId, generation, path, observe),
      current,
      (status) => this.handlers.onHistoryStatus?.(sessionId, status),
      latest ? around : () => this.reading.query(this.deviceId + ':' + sessionId, sessionId, current),
      this.window.observe,
    );
  }

  /** A fresh window around one message, from the rail's outline or a search match. */
  around(sessionId: string, messageId: string, cursor?: string) {
    return this.history(sessionId, true, aroundQuery(messageId, cursor));
  }

  /** The owner's messages of the whole conversation, or the ones that hold the words; they never enter the feed. */
  messages(
    sessionId: string,
    direction: typeof HistoryDirection.Outline | typeof HistoryDirection.Search,
    query?: string,
  ) {
    const generation = this.generations.get(sessionId);

    return generation
      ? requestMessages(this.connection, sessionId, generation, direction, query)
      : Promise.resolve([]);
  }

  page(sessionId: string, direction: HistoryPageDirection, edge?: string) {
    const epoch = this.epoch;
    const generation = this.generations.get(sessionId);

    if (!generation) {
      return Promise.resolve(HistoryPageSkip.Stale);
    }

    return this.window.page(
      direction,
      (query, observe) =>
        requestHistory(
          this.connection,
          sessionId,
          generation,
          query,
          observe,
          edge?.startsWith(HistoryCursorPrefix.Cache),
        ),
      () => this.current(sessionId, epoch),
      edge,
    );
  }

  close() {
    this.stopped = true;
    ++this.epoch;
    this.reading.close();
    this.generations.clear();
  }
}
