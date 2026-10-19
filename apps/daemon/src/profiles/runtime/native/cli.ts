import { ErrorCode } from '@protocol';
import { loadEnrollmentIdentity } from '../../enrollment/identity.js';
import { CliAction } from '../../../domain/cli.js';

export async function runProfilesCli(
  args: readonly string[],
  directory: string,
  write = (value: string) => process.stdout.write(value),
) {
  if (args.length !== 1 || args[0] !== CliAction.Recipient) {
    throw new Error(ErrorCode.INVALID_REQUEST);
  }

  const recipient = await loadEnrollmentIdentity(directory);

  try {
    write(recipient.keyId + '\n');
  } finally {
    recipient.privateKey.fill(0);
  }
}
