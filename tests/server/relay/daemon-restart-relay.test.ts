import { expect, it, vi } from 'vitest';
import { historySchema } from '@protocol';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRelay } from '../../../apps/server/src/app/create-relay.js';
import { startDaemon } from '../../../apps/daemon/src/main.js';
import { LocalStore } from '../../../apps/daemon/src/monitor/store.js';
import { Monitor } from '../../../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry, SourceAdapter } from '../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../apps/daemon/src/commands/permission-broker.js';
import { databaseFixture } from '../../helpers/database.js';
import { initData, testBotToken } from '../../helpers/telegram.js';

it('restores registered native history through the actual relay despite a retired queue head and another daemon restart', async () => {
  const fixture = await databaseFixture();
  const root = await mkdtemp(join(tmpdir(), 'daemon-relay-restart-'));
  let relay: Awaited<ReturnType<typeof createRelay>> | undefined;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  const permissions = new PermissionBroker();

  try {
    relay = await createRelay({
      databaseUrl: fixture.url,
      schema: fixture.schema,
      botToken: testBotToken,
      publicOrigin: 'http://127.0.0.1:4173',
    });

    const origin = await relay.listen(0);
    const ownerToken = (await relay.auth.login(initData('82001'))).token;
    const principal = await relay.auth.authenticate(ownerToken);

    const code = randomBytes(16).toString('hex'),
      proof = randomBytes(32).toString('hex');

    const sha = (value: string) => createHash('sha256').update(value).digest('hex');

    await relay.devices.start(sha(code), sha(proof));
    const claim = await relay.devices.claim(principal, code);
    const device = (await relay.devices.confirm(proof, claim.claimId, true))!;
    const transcript = join(root, 'exact-source.jsonl');

    await writeFile(
      transcript,
      JSON.stringify({
        type: 'assistant',
        uuid: 'before-restart',
        sessionId: 'exact-source',
        message: { content: 'Synthetic restored history' },
      }) + '\n',
    );

    await writeFile(
      join(root, 'device.json'),
      JSON.stringify({ relayUrl: origin, deviceId: device.deviceId, deviceToken: device.token }),
      { mode: 0o600 },
    );

    const store = new LocalStore(join(root, 'state.sqlite'), device.deviceId);
    const adapters = new AdapterRegistry(device.deviceId);

    adapters.register(
      new SourceAdapter({
        connectorId: 'native',
        kind: 'claude-code-cli',
        transport: 'hooks',
        sourceVersion: 'test',
        state: 'ready',
        reason: null,
        capabilities: {
          observe: true,
          history: true,
          prompt: false,
          interrupt: false,
          permission: true,
          terminalSnapshot: false,
        },
      }),
    );

    for (let i = 0; i < 125; i++) {
      store.append({
        sessionId: 'retired-random-session',
        type: 'status',
        payload: {},
        occurredAt: Date.now(),
      });
    }

    const monitor = new Monitor({ deviceId: device.deviceId, store, adapters, permissions });

    monitor.ingestHook(
      { hook_event_name: 'SessionStart', session_id: 'exact-source', transcript_path: transcript },
      'native',
    );

    const original = structuredClone(monitor.findClaude('native', 'exact-source')!);

    store.close();
    vi.stubEnv('CLAUDE_REMOTE_HOME', root);
    vi.stubEnv('CLAUDE_CONFIG_DIR', root);
    vi.stubEnv('CODEX_HOME', join(root, 'isolated-codex'));
    daemon = await startDaemon();
    const recovered = daemon.monitor.session(original.id)!;

    expect(recovered.binding).toBe('unverified');
    expect(recovered.capabilities.permission).toBe(false);

    const messages = async () => {
      const response = await fetch(origin + '/sessions/' + encodeURIComponent(original.id) + '/events', {
        headers: { authorization: 'Bearer ' + ownerToken },
      });

      return response.ok ? ((await response.json()) as import('@protocol').EventEnvelope[]) : [];
    };

    await expect
      .poll(
        async () =>
          (await messages()).some(
            (event) => historySchema.safeParse(event.payload).data?.id === 'before-restart',
          ),
        {
          timeout: 6000,
        },
      )
      .toBe(true);

    expect(
      (
        await relay.db.pool.query(
          "SELECT count(*)::int AS count FROM events WHERE session_id='retired-random-session'",
        )
      ).rows[0].count,
    ).toBe(0);

    const firstGeneration = recovered.generation;

    await daemon.close();
    daemon = undefined;

    await appendFile(
      transcript,
      JSON.stringify({
        type: 'user',
        uuid: 'after-restart',
        sessionId: 'exact-source',
        message: { content: 'Synthetic new history' },
      }) + '\n',
    );

    daemon = await startDaemon();
    expect(daemon.monitor.session(original.id)?.generation).not.toBe(firstGeneration);

    await expect
      .poll(
        async () =>
          (await messages()).some(
            (event) => historySchema.safeParse(event.payload).data?.id === 'after-restart',
          ),
        {
          timeout: 6000,
        },
      )
      .toBe(true);

    const sessions = await relay.db.pool.query('SELECT id FROM sessions WHERE owner_id=$1 AND device_id=$2', [
      principal.userId,
      device.deviceId,
    ]);

    expect(sessions.rows).toEqual([{ id: original.id }]);

    await expect(
      relay.replay(
        await relay.auth.authenticate((await relay.auth.login(initData('82002'))).token),
        device.deviceId,
        { streamId: (await messages())[0]!.streamId, seq: 0 },
      ),
    ).rejects.toThrow('NOT_FOUND');
  } finally {
    await daemon?.close();
    permissions.close();
    vi.unstubAllEnvs();
    await relay?.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
