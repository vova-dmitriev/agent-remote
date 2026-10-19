import { HistoryCursorPrefix, FrameType, type HistoryPageDirection, type ServerFrame } from '@protocol';
import {
  HistoryStream,
  HistoryWindow,
  ReadingPositions,
  loadSessionHistory,
  restoreHistoryWindow,
  type ApplicationOperations,
  type TransportHandlers,
} from '@/shared/api';
import type { ExtensionConnection } from '../connection.js';
import { requestHistory } from './request.js';

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

  history(sessionId: string, latest = false) {
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
      latest ? '' : () => this.reading.query(this.deviceId + ':' + sessionId, sessionId, current),
      this.window.observe,
    );
  }

  page(sessionId: string, direction: HistoryPageDirection, edge?: string) {
    const epoch = this.epoch;
    const generation = this.generations.get(sessionId);

    if (!generation) {
      return Promise.resolve(null);
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
