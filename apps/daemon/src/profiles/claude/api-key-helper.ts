import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodedError, ErrorCode } from '@protocol';
import { ClaudeProfileCredential, ClaudeProfileEnvironment } from './values.js';

export async function readClaudeApiKey(path: string): Promise<string> {
  const credentialPath = resolve(path);

  const parent = await lstat(resolve(credentialPath, '..')).catch(() => {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  });

  if (!parent.isDirectory() || parent.mode & 0o077 || (process.getuid && parent.uid !== process.getuid())) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  const file = await open(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  });

  const bytes = Buffer.alloc(ClaudeProfileCredential.MaxBytes + 1);

  try {
    const info = await file.stat();

    if (
      !info.isFile() ||
      info.mode & 0o077 ||
      info.size < 1 ||
      info.size > ClaudeProfileCredential.MaxBytes ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);

    if (bytesRead < 1 || bytesRead > ClaudeProfileCredential.MaxBytes) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const secret = bytes.subarray(0, bytesRead).toString('utf8');

    if (
      !secret.trim() ||
      Array.from(secret).some((character) => {
        const code = character.charCodeAt(0);

        return /\s/u.test(character) || code < 32 || code === 127;
      })
    ) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    return secret;
  } finally {
    bytes.fill(0);
    await file.close();
  }
}

async function runHelper() {
  const path = process.env[ClaudeProfileEnvironment.ApiKeyFile];

  if (!path) {
    process.exitCode = 1;

    return;
  }

  try {
    process.stdout.write(await readClaudeApiKey(path));
  } catch {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runHelper();
}
