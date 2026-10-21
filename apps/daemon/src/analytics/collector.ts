import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalyticsPeriod, AnalyticsReport, RateLimit, SessionUsage } from '@protocol';
import { logDebug } from '../diagnostics/log.js';
import { claudeLimits } from './parsers/claude-limits.js';
import { claudeUsageRow } from './parsers/claude-usage.js';
import { codexUsage, type CodexFileState } from './parsers/codex-usage.js';
import { sessionUsages, usageReport } from './report.js';
import { UsageStore, type StoredFile, type StoredLimits } from './store.js';
import type { UsageRow } from './parsers/usage-row.js';

export interface AnalyticsSources {
  /** The SQLite file, beside the daemon state. */
  path: string;
  /** Claude config directories (`~/.claude`) and Codex homes (`~/.codex`) whose transcripts count. */
  claudeHomes: readonly string[];
  codexHomes: readonly string[];
  /** Claude Code state files (`~/.claude.json`) that cache Claude's plan limits. */
  claudeStates: readonly string[];
}

export interface CollectorOptions extends AnalyticsSources {
  intervalMs: number;
  /** After every read of the transcripts, so the sessions' usage can follow. */
  onPass?: () => void;
}

/** What the app's surfaces ask of the collector. */
export interface AnalyticsPort {
  report(period: AnalyticsPeriod): Promise<AnalyticsReport>;
}

const CHUNK_BYTES = 2 * 1024 * 1024;
/** A line longer than this carries no usage (a tool result or an attachment) and is skipped unread. */
const MAX_LINE_BYTES = 64 * 1024 * 1024;
const NEWLINE = 0x0a;

type Context = NonNullable<SessionUsage['context']>;

async function transcripts(root: string, keep: (path: string) => boolean) {
  const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);

  return entries.filter((path) => path.endsWith('.jsonl') && keep(path)).map((path) => join(root, path));
}

/** Claude session transcripts and their subagents' transcripts, not the tool output saved beside them. */
const claudeTranscript = (path: string) => path.split('/').length === 2 || /\/subagents\/[^/]+$/u.test(path);

/**
 * Reads Claude and Codex transcripts into the usage store: a first import of everything, then only what each file
 * gained since. Reading yields between chunks so hooks, the relay link and the UI keep running during the import.
 */
export class AnalyticsCollector implements AnalyticsPort {
  private running: Promise<void> = Promise.resolve();
  private importing: AnalyticsReport['importing'] = { done: 0, total: 0 };
  private readonly contexts = new Map<string, Context>();
  private claudeWindows: RateLimit[] = [];
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  private constructor(
    private readonly store: UsageStore,
    private readonly options: CollectorOptions,
  ) {}

  static start(options: CollectorOptions) {
    const collector = new AnalyticsCollector(UsageStore.open(options.path), options);

    void collector.pass();

    return collector;
  }

  /** Queues one read of every transcript after any read in progress. */
  pass() {
    this.running = this.running
      .then(() => this.read())
      .catch((error: unknown) => logDebug('analytics', error));

    return this.running;
  }

  report(period: AnalyticsPeriod) {
    return Promise.resolve(usageReport(this.store, period, this.importing, this.limits()));
  }

  /** Every plan window the agents last reported: Claude's from its state file, Codex's from its rollouts. */
  limits(): RateLimit[] {
    return [...this.claudeWindows, ...this.store.limits()];
  }

  sessionUsages(ids: readonly string[]) {
    return sessionUsages(this.store, ids, this.contexts);
  }

  private async read() {
    clearTimeout(this.timer);

    if (this.closed) {
      return;
    }

    this.claudeWindows = (await Promise.all(this.options.claudeStates.map(claudeLimits))).flat();

    const homes = (
      await Promise.all([
        ...this.options.claudeHomes.map((home) => transcripts(join(home, 'projects'), claudeTranscript)),
        ...this.options.codexHomes.flatMap((home) => [
          transcripts(join(home, 'sessions'), () => true),
          transcripts(join(home, 'archived_sessions'), () => true),
        ]),
      ])
    ).flat();

    const codex = new Set(
      homes.filter((path) => this.options.codexHomes.some((home) => path.startsWith(home))),
    );

    const stored = this.store.files();

    // Newest first: today's numbers are right early in the first import.
    const files = (
      await Promise.all(
        homes.map(async (path) => ({
          path,
          info: await stat(path).catch(() => null), // ignore: a transcript removed since the listing is skipped.
        })),
      )
    )
      .filter((file) => file.info?.isFile())
      .sort((a, b) => b.info!.mtimeMs - a.info!.mtimeMs);

    if (this.importing) {
      this.importing = { done: 0, total: files.length };
    }

    for (const { path, info } of files) {
      if (this.closed) {
        return;
      }

      const known = stored.get(path);

      if (!known || known.inode !== info!.ino || known.offset !== info!.size) {
        await this.readFile(path, codex.has(path), known).catch((error: unknown) =>
          logDebug('analytics', error),
        );
      }

      if (this.importing) {
        this.importing = { ...this.importing, done: this.importing.done + 1 };
      }
    }

    this.importing = null;
    this.options.onPass?.();
    this.timer = setTimeout(() => void this.pass(), this.options.intervalMs).unref();
  }

  private async readFile(path: string, codex: boolean, known: StoredFile | undefined) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      const info = await handle.stat();
      // A shorter file or a new inode is a different file at this path: read it from the start.
      const resume = known && known.inode === info.ino && known.offset <= info.size ? known : undefined;
      const state: CodexFileState = { ...resume?.state };
      let position = resume?.offset ?? 0;
      let carry = Buffer.alloc(0);

      while (!this.closed && position + carry.length < info.size) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, info.size - position - carry.length));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position + carry.length);

        if (!bytesRead) {
          break;
        }

        const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
        const end = data.lastIndexOf(NEWLINE);

        if (end < 0) {
          if (data.length > MAX_LINE_BYTES) {
            [position, carry] = [position + data.length, Buffer.alloc(0)];
          } else {
            carry = data;
          }

          continue;
        }

        const rows: UsageRow[] = [];
        let limits: StoredLimits | undefined;

        for (const line of data.subarray(0, end).toString('utf8').split('\n')) {
          if (!codex) {
            const row = claudeUsageRow(line);

            if (row) {
              rows.push(row);
            }

            continue;
          }

          const read = codexUsage(line, state);

          if (read.row) {
            rows.push(read.row);
          }

          if (read.row && read.context) {
            this.contexts.set(read.row.sessionId, read.context);
          }

          if (read.row && read.limits) {
            limits = { at: read.row.at, limits: read.limits };
          }
        }

        position += end + 1;
        carry = data.subarray(end + 1);
        this.store.save(rows, { path, inode: info.ino, offset: position, state: { ...state } }, limits);
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      await handle.close();
    }
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    await this.running;
    this.store.close();
  }
}
