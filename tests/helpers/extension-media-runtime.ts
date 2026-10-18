import { afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalMediaRepository } from '../../apps/daemon/src/local/media/repository.js';
import { LocalDatabase } from '../../apps/daemon/src/local/state/database.js';
import { LocalOperation, type LocalAction, type Session } from '../../packages/protocol/src/index.js';
import type { LocalPrincipal } from '../../apps/daemon/src/local/grants/types.js';

export const cleanup: (() => void | Promise<void>)[] = [];

export const principal: LocalPrincipal = {
  ownerId: 'owner',
  clientId: 'client',
  origin: 'chrome-extension://test',
  lease: 'lease',
  handle: 'handle',
  deviceId: 'device',
};

export const session = {
  id: 'session',
  generation: 'generation',
  target: { deviceId: 'device' },
  capabilities: { observe: true, history: true },
} as Session;

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'local-media-'));
  const database = new LocalDatabase(join(root, 'state.sqlite'));
  const state = { current: true, session: structuredClone(session) };

  const options = {
    directory: join(root, 'media'),
    database,
    ownerId: principal.ownerId,
    session: (id: string) => (id === state.session.id ? state.session : undefined),
    current: () => state.current,
  };

  const repository = new LocalMediaRepository(options);

  cleanup.push(
    () => rmSync(root, { recursive: true, force: true }),
    () => database.close(),
    () => repository.close(),
  );

  return {
    repository,
    options,
    root,
    state,
    run: (action: LocalAction, who = principal) => repository.execute(who, action),
  };
}

export function begin(byteLength = 3) {
  return {
    operation: LocalOperation.MediaBegin,
    sessionId: session.id,
    generation: session.generation,
    uploadId: randomUUID(),
    name: '../../synthetic.txt',
    mimeType: 'text/plain',
    byteLength,
  } as const;
}

export function controlledBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let pulled!: () => void;
  let cancelled = false;

  const reading = new Promise<void>((resolve) => {
    pulled = resolve;
  });

  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    pull() {
      pulled();
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    body,
    reading,
    get controller() {
      return controller;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

export async function fillTransfers(f: ReturnType<typeof fixture>) {
  for (let index = 0; index < 16; index++) {
    await f.run(begin());
  }
}

export function restartWithExpiredStage(f: ReturnType<typeof fixture>) {
  const path = join(f.options.directory, randomUUID() + '.part');

  writeFileSync(path, 'synthetic interrupted upload', { mode: 0o600 });
  const expired = new Date(Date.now() - 301000);

  utimesSync(path, expired, expired);
  const resumed = new LocalMediaRepository(f.options);

  cleanup.push(() => resumed.close());
}
