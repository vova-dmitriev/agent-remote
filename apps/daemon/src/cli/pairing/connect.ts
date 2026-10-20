import { DaemonErrorCode } from '../../error-codes.js';
import { CodedError, ErrorCode } from '@protocol';

import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, saveConfig, localSecret, validateRelayUrl, type DaemonConfig } from '../../config.js';
import { openTelegram, confirmOnMac } from './local.js';
import { logDebug } from '../../diagnostics/log.js';

export interface PairingDependencies {
  request: (
    origin: string,
    path: string,
    body: Record<string, string | boolean>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  open: (url: string, signal: AbortSignal) => Promise<void>;
  confirm: (telegramId: string, signal: AbortSignal) => Promise<boolean>;
  load: () => Promise<DaemonConfig>;
  save: (config: DaemonConfig) => Promise<void>;
  secret: () => Promise<string>;
  random: (bytes: number) => string;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  write: (text: string) => void;
}

const registrationSchema = z.object({
  expiresAt: z.number().finite().positive(),
  botUsername: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/)
    .optional(),
});

const statusSchema = z.object({
  claimId: z.string().min(1).nullable(),
  telegramId: z.string().nullable(),
  expiresAt: z.number().finite(),
});

const confirmationSchema = z.object({ deviceId: z.string().min(1), token: z.string().min(1) }).nullable();

function response<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new CodedError(DaemonErrorCode.INVALID_PAIRING_RESPONSE);
  }

  return parsed.data;
}

interface ConnectOptions {
  relayUrl?: string;
  botUsername?: string;
  manual?: boolean;
  signal?: AbortSignal;
}

const defaults: PairingDependencies = {
  async request(origin, path, body, signal) {
    const response = await fetch(new URL(path, origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new CodedError(`RELAY_${response.status}`);
    }

    return response.json();
  },
  open: openTelegram,
  confirm: confirmOnMac,
  load: loadConfig,
  save: saveConfig,
  secret: localSecret,
  random: (bytes) => randomBytes(bytes).toString('hex'),
  now: Date.now,
  sleep: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
  write: (text) => {
    process.stdout.write(text);
  },
};

export async function ensureMacConnected(options: ConnectOptions = {}, deps = defaults) {
  try {
    await deps.load();

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return connectMac(options, deps);
}

export async function connectMac(options: ConnectOptions = {}, deps = defaults) {
  const relayUrl = validateRelayUrl(options.relayUrl ?? 'http://127.0.0.1:3040');

  const code = deps.random(16),
    proof = deps.random(32);

  const sha = (value: string) => createHash('sha256').update(value).digest('hex');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;

  let started = false,
    complete = false,
    deadline = deps.now() + 300000;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    if (options.signal?.aborted) {
      throw new CodedError(DaemonErrorCode.PAIRING_CANCELLED);
    }

    if (signal.aborted || deps.now() >= deadline) {
      throw new CodedError(ErrorCode.PAIRING_EXPIRED);
    }
  };

  try {
    check();
    started = true;

    const registration = response(
      registrationSchema,
      await deps.request(
        relayUrl,
        '/device/pair/start',
        { codeHash: sha(code), proofHash: sha(proof) },
        signal,
      ),
    );

    deadline = Math.min(deadline, Number(registration.expiresAt) || deadline);
    timer = setTimeout(() => controller.abort(), Math.max(0, deadline - deps.now()));
    check();

    deps.write(
      `Код подключения (5 минут): ${code}\nЕсли ссылка не открылась, введи код в Telegram Mini App.\n`,
    );

    const username = options.botUsername ?? registration.botUsername;

    if (!options.manual && typeof username === 'string' && /^[A-Za-z0-9_]+$/.test(username)) {
      const url = `https://t.me/${username}?start=pair_${code}`;

      deps.write(`Открой Telegram и нажми Start: ${url}\n`);

      try {
        await deps.open(url, signal);
      } catch {
        check();
      }
    }

    while (true) {
      check();

      const status = response(
        statusSchema,
        await deps.request(relayUrl, '/device/pair/status', { proof }, signal),
      );

      check();

      if (status.claimId) {
        if (!/^[1-9][0-9]{0,18}$/.test(String(status.telegramId))) {
          throw new CodedError(DaemonErrorCode.INVALID_PAIRING_IDENTITY);
        }

        const approved = await deps.confirm(String(status.telegramId), signal);

        check();

        const result = response(
          confirmationSchema,
          await deps.request(
            relayUrl,
            '/device/pair/confirm',
            { proof, claimId: status.claimId, approved },
            signal,
          ),
        );

        check();

        if (!result) {
          deps.write('Подключение отклонено.\n');

          return false;
        }

        await deps.save({ relayUrl, deviceId: result.deviceId, deviceToken: result.token });
        await deps.secret();
        complete = true;
        deps.write('Mac подключён.\n');

        return true;
      }

      await deps.sleep(Math.min(1500, Math.max(0, deadline - deps.now())), signal);
    }
  } catch (error) {
    check();
    throw error;
  } finally {
    clearTimeout(timer);

    if (started && !complete) {
      await deps
        .request(relayUrl, '/device/pair/cancel', { proof })
        .catch((error: unknown) => logDebug('cli/pairing/connect', error));
    }
  }
}
