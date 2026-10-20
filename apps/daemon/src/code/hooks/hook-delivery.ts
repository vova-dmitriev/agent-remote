import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  defaultStateDirectory,
  hookSocketPath,
  localSecret,
  readLocalSecret,
  stateDirectory,
} from '../../config.js';
import { requestLocal } from './ipc.js';
import { logDebug } from '../../diagnostics/log.js';

/** Where a desktop companion that yielded the CLI hook path says it still listens. */
const PEER_FILE = 'hook-peer.json';
const peerSchema = z.strictObject({ directory: z.string().max(4096).refine(isAbsolute) });

export interface HookTarget {
  path: string;
  token: string;
}

/** Desktop companion side: while the CLI daemon holds the hook path, hooks still reach the companion's own socket. */
export async function writeHookPeer(directory: string, cliDirectory = defaultStateDirectory()) {
  await mkdir(cliDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(cliDirectory, PEER_FILE), JSON.stringify({ directory }), { mode: 0o600 });
}

export async function removeHookPeer(cliDirectory = defaultStateDirectory()) {
  await rm(join(cliDirectory, PEER_FILE), { force: true });
}

/** The daemon on this hook's own path, then a desktop companion that yielded it, if any. */
export async function hookTargets(): Promise<HookTarget[]> {
  const directory = stateDirectory();
  const targets = [{ path: hookSocketPath(directory), token: await localSecret(directory) }];

  try {
    const peer = peerSchema.parse(JSON.parse(await readFile(join(directory, PEER_FILE), 'utf8'))).directory;

    if (resolve(peer) !== resolve(directory)) {
      targets.push({ path: hookSocketPath(peer), token: await readLocalSecret(peer) });
    }
  } catch (error) {
    logDebug('code/hooks/hook-delivery', error);
  }

  return targets;
}

/**
 * Gives one Claude hook to every target. The first non-empty answer (a permission decision) wins and the other
 * requests are dropped, which cancels their pending prompts; with no decision the answer is empty.
 */
export function deliverHook(
  targets: HookTarget[],
  frame: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let left = targets.length;

  return new Promise((done) => {
    if (!left) {
      done({});
    }

    for (const target of targets) {
      void requestLocal(target.path, { ...frame, token: target.token }, timeoutMs, controller.signal)
        .then(
          (reply) => (reply.output && typeof reply.output === 'object' ? reply.output : {}),
          () => ({}),
        )
        .then((output) => {
          left--;

          if (Object.keys(output).length) {
            controller.abort();
            done(output as Record<string, unknown>);
          } else if (!left) {
            done({});
          }
        });
    }
  });
}
