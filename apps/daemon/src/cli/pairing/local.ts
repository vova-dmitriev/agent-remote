import { DaemonErrorCode } from '../../error-codes.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { CodedError } from '@protocol';

const execute = promisify(execFile);

export async function openTelegram(url: string, signal: AbortSignal) {
  if (process.platform !== 'darwin') {
    return;
  }

  await execute('open', [url], { signal, timeout: 10000 });
}

export async function confirmOnMac(telegramId: string, signal: AbortSignal) {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execute(
        'osascript',
        [
          '-e',
          [
            'on run argv',
            'display dialog ("Allow this Telegram account to access this Mac? Telegram ID: " & item 1 of argv) with title "Agent Remote" buttons {"Cancel", "Connect"} default button "Connect" cancel button "Cancel"',
            'return button returned of result',
            'end run',
          ].join('\n'),
          telegramId,
        ],
        { signal },
      );

      return stdout.trim() === 'Connect';
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }

      if (String((error as { stderr?: string }).stderr).includes('(-128)')) {
        return false;
      }
    }
  }

  if (!process.stdin.isTTY) {
    throw new CodedError(DaemonErrorCode.PAIRING_CONFIRMATION_REQUIRES_TERMINAL);
  }

  const input = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return (
      (await input.question(`Allow Telegram ID ${telegramId} to connect? [yes/no] `, { signal }))
        .trim()
        .toLowerCase() === 'yes'
    );
  } finally {
    input.close();
  }
}
