import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { LocalKind, LocalOperation, ProfileAction, ProfileRequestKind, ProfileStatus } from '@protocol';
import { RuntimeProfiles } from '../apps/daemon/src/runtime/services/runtime-profiles.js';
import { startLocalServer } from '../apps/daemon/src/local/server/server.js';
import { FramedPeer } from '../apps/daemon/src/browser/transport/peer.js';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { profileServiceFixture } from './profiles/service.fixture.js';
import { localFixture, localTestOrigin } from './helpers/local-runtime.js';
import { deferred } from './profiles/runtime/deferred.js';

it.each(['disconnect', 'logout'])(
  'does not mark an API profile ready after local viewer %s',
  async (mode) => {
    const { directory } = profileServiceFixture();
    const local = localFixture();
    const held = deferred<void>();
    const verifying = deferred<void>();
    const settings = join(directory, 'native.json');

    writeFileSync(settings, '{}');

    const profiles = new RuntimeProfiles({
      database: local.database,
      directory,
      scope: { ownerId: 'owner-local', deviceId: 'device-local' },
      inputEnabled: true,
      baseEnvironment: {},
      native: {
        executable: process.execPath,
        prefixArguments: [resolve('tests/profiles/native-peer.mjs'), settings],
        apiFetch: async () => {
          verifying.resolve();
          await held.promise;

          return Response.json({ data: [{ id: 'synthetic-model' }] });
        },
      },
    });

    local.controller.options.profiles = profiles;
    const executing = vi.spyOn(local.controller, 'execute');

    const create = await profiles.request({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Create,
        operationId: randomUUID(),
        input: { provider: 'codex', authMode: 'api_key', label: 'Synthetic' },
      },
    });

    if (create.kind !== ProfileRequestKind.Mutate) {
      throw new Error('unexpected create');
    }

    const recipient = await profiles.request({ kind: ProfileRequestKind.Recipient });

    if (recipient.kind !== ProfileRequestKind.Recipient) {
      throw new Error('unexpected recipient');
    }

    const begin = await profiles.request({
      kind: ProfileRequestKind.BeginEnrollment,
      input: {
        operationId: randomUUID(),
        profileId: create.data.profileId,
        expectedVersion: 1,
        pinnedKeyId: recipient.data.recipientKeyId,
      },
    });

    if (begin.kind !== ProfileRequestKind.BeginEnrollment) {
      throw new Error('unexpected challenge');
    }

    const input = await encryptEnrollment(
      begin.data,
      'synthetic-local-credential',
      recipient.data.recipientKeyId,
    );

    const path = join(directory, 'local.sock');
    const capability = randomUUID();

    const server = await startLocalServer({
      path,
      capability,
      grants: local.grants,
      controller: local.controller,
    });

    const socket = connect(path);
    const received: Array<Record<string, unknown>> = [];

    const peer = new FramedPeer(socket, socket, (raw) => {
      received.push(raw as Record<string, unknown>);
    });

    await peer.send({
      capability,
      origin: localTestOrigin,
      hello: {
        kind: LocalKind.Hello,
        version: 1,
        requestId: randomUUID(),
        clientId: local.principal.clientId,
        handle: local.principal.handle,
      },
    });

    await expect.poll(() => received.find((frame) => frame.kind === LocalKind.Result)).toBeTruthy();
    const hello = received.find((frame) => frame.kind === LocalKind.Result)!;
    const lease = (hello.data as { lease: string }).lease;
    const requestId = randomUUID();

    await peer.send({
      kind: LocalKind.Request,
      version: 1,
      requestId,
      lease,
      action: {
        operation: LocalOperation.Profiles,
        request: { kind: ProfileRequestKind.CompleteEnrollment, input },
      },
    });

    await verifying.promise;
    const pending = executing.mock.results[0]!.value as Promise<unknown>;
    const rejected = expect(pending).rejects.toThrow(/^UNAUTHORIZED$/);

    if (mode === 'logout') {
      await peer.send({
        kind: LocalKind.Request,
        version: 1,
        requestId: randomUUID(),
        lease,
        action: { operation: LocalOperation.Logout },
      });
    } else {
      peer.close();
      await expect.poll(() => local.controller.hasViewers()).toBe(false);
    }

    // Deliver the logout frame while the previous serialized request is still waiting.
    await new Promise((done) => setTimeout(done, 30));
    held.resolve();

    try {
      await rejected;
      const list = await profiles.request({ kind: ProfileRequestKind.List });

      expect(list.kind === ProfileRequestKind.List && list.data.profiles[0]?.status).not.toBe(
        ProfileStatus.Ready,
      );
    } finally {
      peer.close();
      await server.close();
      await local.close();
    }
  },
);
