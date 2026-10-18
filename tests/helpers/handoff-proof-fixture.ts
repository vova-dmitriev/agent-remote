import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createRelay } from '../../apps/server/src/relay.js';
import { initData, testBotToken } from '../helpers/telegram.js';
import type { AppSnapshot, Session } from '../../packages/protocol/src/index.js';
import { WebSocket } from 'ws';

const url =
  process.env.TEST_DATABASE_URL ??
  'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export type HandoffProofFixture = {
  relay: Awaited<ReturnType<typeof createRelay>>;
  principal: { userId: string; telegramId: string };
  device: { deviceId: string; token: string };
  socket: WebSocket;
  close: () => Promise<void>;
};

export async function waitFrame(
  socket: WebSocket,
  predicate: (value: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS_FRAME_TIMEOUT')), 3000);

    socket.on('message', function receive(raw) {
      const value = JSON.parse(String(raw)) as Record<string, unknown>;

      if (predicate(value)) {
        clearTimeout(timeout);
        socket.off('message', receive);
        resolve(value);
      }
    });
  });
}

export async function rejectProofs(socket: WebSocket, proofs: readonly unknown[]) {
  for (const proof of proofs) {
    const rejected = waitFrame(socket, (value) => value.type === 'error');

    socket.send(JSON.stringify(proof));

    if ((await rejected).code !== 'CONTINUITY_SEED_PROOF_MISMATCH') {
      throw new Error('INVALID_PROOF_ACCEPTED');
    }
  }
}

export function readyTargetSnapshot(
  deviceId: string,
  sessionId: string,
  generation: string,
  model = 'claude-test',
): AppSnapshot {
  const session: Session = {
    id: sessionId,
    target: { kind: 'claude-code-cli', deviceId, connectorId: 'native', claudeSessionId: sessionId },
    claudeSessionId: sessionId,
    generation,
    status: 'idle',
    cwd: '/tmp/claude',
    model,
    binding: 'verified',
    lastEventAt: 20,
    capabilities: {
      observe: true,
      history: true,
      prompt: true,
      interrupt: true,
      permission: true,
      createSession: true,
      terminalSnapshot: false,
    },
    integrationState: 'ready',
    statusConfidence: 'observed',
  };

  return {
    sessions: [session],
    cursor: { streamId: 'proof', seq: 0 },
    deviceStatus: 'online',
    permissions: [],
    terminal: null,
  };
}

export async function startHandoffProofFixture(): Promise<HandoffProofFixture> {
  const schema = `proof_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });

  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const relay = await createRelay({
    databaseUrl: url,
    schema,
    botToken: testBotToken,
    publicOrigin: 'http://127.0.0.1:4173',
    inputEnabled: true,
    permissionsEnabled: true,
  });

  const origin = await relay.listen(0);
  const login = await relay.auth.login(initData('777001'));
  const principal = await relay.auth.authenticate(login.token);
  const code = randomBytes(16).toString('hex');
  const proof = randomBytes(32).toString('hex');

  await relay.devices.start(sha(code), sha(proof));
  const claim = await relay.devices.claim(principal, code);
  const device = (await relay.devices.confirm(proof, claim.claimId, true))!;

  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/device', {
    origin: 'http://127.0.0.1:4173',
  });

  socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: device.token })));
  await waitFrame(socket, (value) => value.type === 'authenticated');

  return {
    relay,
    principal,
    device,
    socket,
    close: async () => {
      socket.terminate();
      await relay.close();
      const cleanup = new Pool({ connectionString: url });

      await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await cleanup.end();
    },
  };
}
