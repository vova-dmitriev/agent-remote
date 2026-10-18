import { join } from 'node:path';
import { z } from 'zod';
import { ErrorCode } from '../../../../../packages/protocol/src/index.js';
import {
  createEnrollmentRecipient,
  restoreEnrollmentRecipient,
} from '../../../../../packages/transport/src/credentials/recipient.js';
import { privateFile } from '../../local/bootstrap/private-file.js';

const identitySchema = z.strictObject({
  publicKey: z.string().length(44),
  privateKey: z.string().length(44),
});

export async function loadEnrollmentIdentity(directory: string) {
  const candidate = await createEnrollmentRecipient();
  let encoded: string;

  try {
    encoded = await privateFile(join(directory, 'credential-enrollment-key.json'), () =>
      JSON.stringify({
        publicKey: candidate.publicKey,
        privateKey: Buffer.from(candidate.privateKey).toString('base64'),
      }),
    );
  } finally {
    candidate.privateKey.fill(0);
  }

  try {
    const stored = identitySchema.parse(JSON.parse(encoded));

    return await restoreEnrollmentRecipient(stored.publicKey, stored.privateKey);
  } catch {
    throw new Error(ErrorCode.ENROLLMENT_UNAVAILABLE);
  }
}
