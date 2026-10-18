import { createHash } from 'node:crypto';
import {
  CheckpointAttachmentStatus,
  CheckpointError,
  CheckpointLimits,
  checkpointFailure,
} from './values.js';
import type { CheckpointAttachmentReference } from './types.js';
import { readPrivateFile, writePrivateFile } from './storage.js';

const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function persistAttachment(
  directory: string,
  reference: CheckpointAttachmentReference,
  read: (reference: CheckpointAttachmentReference) => Promise<Uint8Array>,
  maxBytes: number,
) {
  try {
    const bytes = await read(reference);

    if (bytes.byteLength > maxBytes) {
      throw checkpointFailure(CheckpointError.AttachmentSizeLimit);
    }

    const hash = hashOf(bytes);

    try {
      await writePrivateFile(directory, `${hash}.blob`, bytes, maxBytes);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }

      if (hashOf(await readPrivateFile(directory, `${hash}.blob`, maxBytes)) !== hash) {
        throw checkpointFailure(CheckpointError.AttachmentTampered);
      }
    }

    return { id: reference.id, hash, status: CheckpointAttachmentStatus.Available } as const;
  } catch (error) {
    if (error instanceof Error && error.message === CheckpointError.StorageUnsafe) {
      throw error;
    }

    return { id: reference.id, hash: null, status: CheckpointAttachmentStatus.Missing } as const;
  }
}

export async function verifyAttachmentBlobs(
  directory: string,
  refs: readonly { hash: string | null; status: string }[],
  maxBytes = CheckpointLimits.MaxAttachmentBytes,
) {
  for (const ref of refs) {
    if (
      ref.status !== CheckpointAttachmentStatus.Available ||
      !ref.hash ||
      !/^[a-f0-9]{64}$/.test(ref.hash)
    ) {
      if (ref.status === CheckpointAttachmentStatus.Available) {
        throw checkpointFailure(CheckpointError.AttachmentReferenceInvalid);
      }

      continue;
    }

    let bytes: Buffer;

    try {
      bytes = await readPrivateFile(directory, `${ref.hash}.blob`, maxBytes);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === CheckpointError.StorageSizeLimit ||
          error.message === CheckpointError.StorageUnsafe)
      ) {
        throw error;
      }

      throw checkpointFailure(CheckpointError.AttachmentMissing);
    }

    if (hashOf(bytes) !== ref.hash) {
      throw checkpointFailure(CheckpointError.AttachmentTampered);
    }
  }
}
