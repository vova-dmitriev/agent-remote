import { type PoolClient } from 'pg';
import { Fault } from '../http/errors/fault.js';
import { ATTACHMENT_OWNER_QUOTA_BYTES } from './limits.js';
import { AttachmentFaultCode } from './errors.js';
import { type AttachmentRepository } from './repositories/attachments.js';

/** Makes room for `needed` bytes within the owner's quota, evicting the oldest export-only blobs first. */
export async function reserveAttachmentBytes(
  attachments: AttachmentRepository,
  tx: PoolClient,
  owner: string,
  needed: number,
) {
  let used = await attachments.usage(tx, owner);

  if (used + needed <= ATTACHMENT_OWNER_QUOTA_BYTES) {
    return;
  }

  const candidates = await attachments.evictable(tx, owner);
  const remove: string[] = [];

  for (const row of candidates) {
    if (used + needed <= ATTACHMENT_OWNER_QUOTA_BYTES) {
      break;
    }

    remove.push(row.sha256);
    used -= row.size;
  }

  if (used + needed > ATTACHMENT_OWNER_QUOTA_BYTES) {
    throw new Fault(AttachmentFaultCode.Quota);
  }

  await attachments.evict(tx, owner, remove);
  await attachments.pruneBlobs(tx, owner);
}
