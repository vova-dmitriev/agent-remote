import { type PoolClient } from 'pg';
import { Fault } from '../http/fault.js';
import { ATTACHMENT_OWNER_QUOTA_BYTES } from './limits.js';
import { AttachmentFaultCode } from './errors.js';

export async function pruneAttachmentBlobs(tx: PoolClient, owner: string) {
  await tx.query(
    'DELETE FROM attachment_blobs b WHERE b.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.owner_id=b.owner_id AND a.blob_sha256=b.sha256)',
    [owner],
  );
}

export async function reserveAttachmentBytes(tx: PoolClient, owner: string, needed: number) {
  const size = (
    await tx.query<{ total: string }>(
      `SELECT ((SELECT coalesce(sum(octet_length(bytes)),0) FROM attachments WHERE owner_id=$1)+(SELECT coalesce(sum(octet_length(bytes)),0) FROM attachment_blobs WHERE owner_id=$1))::text AS total`,
      [owner],
    )
  ).rows[0];

  let used = Number(size?.total ?? 0);

  if (used + needed <= ATTACHMENT_OWNER_QUOTA_BYTES) {
    return;
  }

  const candidates = (
    await tx.query<{ sha256: string; size: number }>(
      `SELECT b.sha256,max(octet_length(b.bytes))::int AS size FROM attachment_blobs b JOIN attachments a ON a.owner_id=b.owner_id AND a.blob_sha256=b.sha256 WHERE b.owner_id=$1 GROUP BY b.sha256 HAVING bool_and(a.device_export) ORDER BY min(a.created_at)`,
      [owner],
    )
  ).rows;

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

  await tx.query(
    'DELETE FROM attachments WHERE owner_id=$1 AND device_export AND source_position IS NULL AND blob_sha256=ANY($2::text[])',
    [owner, remove],
  );

  await tx.query('DELETE FROM attachment_blobs WHERE owner_id=$1 AND sha256=ANY($2::text[])', [
    owner,
    remove,
  ]);

  await pruneAttachmentBlobs(tx, owner);
}
