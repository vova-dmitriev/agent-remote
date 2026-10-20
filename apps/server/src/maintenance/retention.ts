import type { AttachmentRepository } from '../attachments/repositories/attachments.js';
import type { CommandRepository } from '../commands/repositories/audit.js';
import type { HistoryRepository } from '../history/repository.js';
import {
  COMMAND_AUDIT_RETENTION_MS,
  EVENT_RETENTION_MS,
  EVENTS_PER_DEVICE,
  RETENTION_BATCH,
} from './limits.js';

/** Repeats a batched delete until a batch removes nothing, so no single statement holds locks on many rows. */
async function drain(batch: (limit: number) => Promise<number>) {
  while ((await batch(RETENTION_BATCH)) > 0) {
    /* The next batch starts after this one commits. */
  }
}

/** One retention pass over every owner: expired attachments, old or surplus events, old commands. Deletions only. */
export class Retention {
  constructor(
    private readonly history: HistoryRepository,
    private readonly commands: CommandRepository,
    private readonly attachments: AttachmentRepository,
  ) {}

  async run(now = Date.now()) {
    const { history, commands, attachments } = this;

    await attachments.prune(now);

    for (const deviceId of await history.deviceIds()) {
      await drain((limit) => history.pruneOlder(deviceId, now - EVENT_RETENTION_MS, limit));
      await drain((limit) => history.pruneSurplus(deviceId, EVENTS_PER_DEVICE, limit));
    }

    await drain((limit) => commands.pruneBatch(now - COMMAND_AUDIT_RETENTION_MS, limit));
  }
}
