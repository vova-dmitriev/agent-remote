import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Pool } from 'pg';
import type { AttachmentDescriptor, ClientCommand, CommandResult } from '@protocol';
import {
  CONTROL_TOKEN_HEADER,
  RELAY_CONFIG_ENV,
  RELAY_READY_PREFIX,
  RelayControlMethod,
  decodeControl,
  encodeControl,
  type ControlResponse,
  type RelayProcessConfig,
  type RelayReady,
} from './relay-control.js';

const ENTRY = resolve('tests/e2e/support/relay-entry.ts');
const READY_TIMEOUT_MS = 60000;
const STOP_TIMEOUT_MS = 10000;

export interface RemotePrincipal {
  userId: string;
  telegramId: string;
}

export interface AttachmentContext {
  ownerId: string;
  deviceId: string;
  sessionId: string;
}

function waitForReady(child: ChildProcess) {
  return new Promise<RelayReady>((resolveReady, reject) => {
    const errors: string[] = [];
    const timer = setTimeout(() => reject(new Error('E2E_RELAY_START_TIMEOUT ' + errors.join(''))), READY_TIMEOUT_MS);

    child.stderr!.on('data', (chunk: Buffer) => {
      errors.push(String(chunk));
      process.stderr.write(chunk);
    });

    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`E2E_RELAY_EXITED ${code} ${errors.join('')}`));
    });

    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (line.startsWith(RELAY_READY_PREFIX)) {
        clearTimeout(timer);
        resolveReady(JSON.parse(line.slice(RELAY_READY_PREFIX.length)) as RelayReady);
      }
    });
  });
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);

  child.kill('SIGTERM');
  await exited;
  clearTimeout(timer);
}

/** Starts the relay in its own Node process (tsx) and returns a client for the calls the specs used to make in-process. */
export async function startRelayProcess(options: Omit<RelayProcessConfig, 'controlToken'>) {
  const config: RelayProcessConfig = { ...options, controlToken: randomBytes(32).toString('hex') };

  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY], {
    env: { ...process.env, [RELAY_CONFIG_ENV]: JSON.stringify(config) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let ready: RelayReady;

  try {
    ready = await waitForReady(child);
  } catch (error) {
    await stop(child);
    throw error;
  }

  const call = async <T>(method: RelayControlMethod, ...args: unknown[]): Promise<T> => {
    const response = await fetch(ready.control, {
      method: 'POST',
      headers: { [CONTROL_TOKEN_HEADER]: config.controlToken },
      body: encodeControl({ method, args }),
    });

    if (!response.ok) throw new Error('E2E_RELAY_CONTROL_' + response.status);
    const result = decodeControl(await response.text()) as ControlResponse;

    if ('error' in result) throw Object.assign(new Error(result.error.message), { code: result.error.code });

    return result.value as T;
  };

  const pool = new Pool({ connectionString: config.databaseUrl, options: `-c search_path=${config.schema}` });
  let closing: Promise<void> | undefined;

  return {
    origin: ready.origin,
    db: { pool },
    auth: {
      login: (initData: string) => call<{ token: string }>(RelayControlMethod.Login, initData),
      authenticate: (token: string) => call<RemotePrincipal>(RelayControlMethod.Authenticate, token),
    },
    devices: {
      start: (codeHash: string, proofHash: string) => call<unknown>(RelayControlMethod.PairStart, codeHash, proofHash),
      claim: (p: RemotePrincipal, code: string) => call<{ claimId: string }>(RelayControlMethod.PairClaim, p, code),
      confirm: (proof: string, claimId: string, approved: boolean) =>
        call<{ deviceId: string; token: string } | null>(RelayControlMethod.PairConfirm, proof, claimId, approved),
      status: (proof: string) => call<{ claimId?: string }>(RelayControlMethod.PairStatus, proof),
      owned: (p: RemotePrincipal, deviceId: string) => call<unknown>(RelayControlMethod.DeviceOwned, p, deviceId),
    },
    command: (p: RemotePrincipal, command: ClientCommand) => call<CommandResult>(RelayControlMethod.Command, p, command),
    live: { has: (deviceId: string) => call<boolean>(RelayControlMethod.LiveHas, deviceId) },
    attachments: {
      store: (context: AttachmentContext, upload: Record<string, unknown>, deviceExport: boolean) =>
        call<AttachmentDescriptor>(RelayControlMethod.StoreAttachment, context, upload, deviceExport),
    },
    notifications: {
      updates: (updates: unknown[]) => call<unknown>(RelayControlMethod.BotUpdates, updates),
      deliver: (appUrl: string, outboxId: string) => call<unknown[]>(RelayControlMethod.DeliverNotification, appUrl, outboxId),
    },
    close() {
      closing ??= stop(child).finally(() => pool.end());

      return closing;
    },
  };
}

export type RemoteRelay = Awaited<ReturnType<typeof startRelayProcess>>;
