import { DaemonErrorCode } from '../../error-codes.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';

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
            'display dialog ("Разрешить этому Telegram-аккаунту доступ к Mac? Telegram ID: " & item 1 of argv) with title "Agent Remote" buttons {"Отмена", "Подключить"} default button "Подключить" cancel button "Отмена"',
            'return button returned of result',
            'end run',
          ].join('\n'),
          telegramId,
        ],
        { signal },
      );

      return stdout.trim() === 'Подключить';
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
    throw new Error(DaemonErrorCode.PAIRING_CONFIRMATION_REQUIRES_TERMINAL);
  }

  const input = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return (
      (await input.question(`Разрешить подключение Telegram ID ${telegramId}? [yes/no] `, { signal }))
        .trim()
        .toLowerCase() === 'yes'
    );
  } finally {
    input.close();
  }
}
