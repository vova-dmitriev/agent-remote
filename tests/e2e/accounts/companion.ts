import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LocalDatabase } from '../../../apps/daemon/src/local/state/database.js';
import { RuntimeProfiles } from '../../../apps/daemon/src/runtime/services/runtime-profiles.js';
import { RuntimeProfileRelay } from '../../../apps/daemon/src/profiles/runtime/router/relay.js';
import { FrameType, serverFrameSchema, type ProfileRequest } from '@protocol';
import { deviceFixture, liveEpoch, rememberEpoch } from '../support/relay-fixture.js';
import { WebSocket } from 'ws';
import { sessionSnapshot } from '../support/session-fixtures.js';

interface ProfileCompanionOptions { beforeApi?: () => Promise<void> }

export async function profileCompanion(options: ProfileCompanionOptions = {}) {
  const { deviceId, deviceToken, sockets } = deviceFixture();
  const directory = await mkdtemp(join(tmpdir(), 'remote-e2e-profiles-'));
  const database = new LocalDatabase(join(directory, 'profiles.sqlite'));
  const settings = join(directory, 'native-settings.json');

  await writeFile(settings, JSON.stringify({ completeSubscription: true }));

  const runtime = new RuntimeProfiles({ database, directory, scope: { ownerId: 'synthetic-local-owner', deviceId }, inputEnabled: true,
    baseEnvironment: {}, native: { executable: process.execPath,
      prefixArguments: [resolve('tests/profiles/native-peer.mjs'), settings],
      apiFetch: async () => { await options.beforeApi?.();

 return Response.json({ data: [{ id: 'synthetic-model' }] }); },
    },
  });

  const bridge = new RuntimeProfileRelay(runtime, liveEpoch, (frame) => {
    sockets[0]!.send(JSON.stringify(frame));

    return true;
  });

  const requests: ProfileRequest[] = [];
  const cancelledRequests: string[] = [];
  const tasks = new Set<Promise<void>>();

  const receive = (raw: unknown) => {
    const parsed = serverFrameSchema.safeParse(JSON.parse(String(raw)));

    if (parsed.success && (parsed.data.type === FrameType.ProfilesRequest || parsed.data.type === FrameType.ProfilesCancel)) {
      if (parsed.data.type === FrameType.ProfilesRequest) { requests.push(parsed.data.request); }

      if (parsed.data.type === FrameType.ProfilesCancel) { cancelledRequests.push(parsed.data.requestId); }

      const task = bridge.receive(parsed.data);

      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    }
  };

  sockets[0]!.on('message', receive);
  const recipient = await runtime.request({ kind: 'recipient' });

  if (recipient.kind !== 'recipient') { throw new Error('SYNTHETIC_RECIPIENT_MISSING'); }

  return { runtime, directory, database, requests, cancelledRequests, idle: () => Promise.all([...tasks]), pin: recipient.data.recipientKeyId,
    reconnect: async () => {
      const socket = new WebSocket('ws://127.0.0.1:3000/ws/device');

      sockets[0] = socket;
      socket.on('message', receive);

      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => socket.send(JSON.stringify({ type: FrameType.Auth, token: deviceToken })));
        socket.once('error', reject);

        socket.on('message', (raw) => {
          const frame = JSON.parse(String(raw));

          if (frame.type === FrameType.Authenticated) {
            rememberEpoch(socket, frame.epoch);
            resolve();
          }
        });
      });

      socket.send(JSON.stringify({ type: FrameType.Snapshot, snapshot: sessionSnapshot(deviceId), connectors: [] }));
    },
    close: async () => {
      sockets[0]!.off('message', receive);
      bridge.disconnect();
      await runtime.close();
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
