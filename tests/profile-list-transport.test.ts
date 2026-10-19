import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { RuntimeProfiles } from '../apps/daemon/src/runtime/services/runtime-profiles.js';
import { RuntimeProfileRelay } from '../apps/daemon/src/profiles/runtime/router/relay.js';
import { BoundedSender } from '@transport/bounded-sender.js';
import {
  ErrorCode,
  FrameType,
  ProfileLimits,
  ProfileRequestKind,
  type DeviceFrame,
  type ProfileRequest,
} from '@protocol';
import { profileServiceFixture } from './profiles/service.fixture.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { readProfilePages } from '../apps/server/src/profiles/transport/list.js';

it('reads a maximum valid registry in bounded pages and rejects oversized legacy replies without closing the device socket', async () => {
  const { options, service } = profileServiceFixture();

  for (let index = 0; index < ProfileLimits.ActiveProfiles; index++) {
    const profile = service.registry.create({ ...codexSubscription, label: `Synthetic ${index}` });

    service.registry.verify(profile.id, profile.version, {
      ...verifiedAccount(),
      models: Array.from({ length: 100 }, (_, i) => ({ id: `model-${i}-` + 'x'.repeat(500), efforts: [] })),
    });
  }

  const runtime = new RuntimeProfiles({
    ...options,
    inputEnabled: true,
    baseEnvironment: {},
    native: { executable: process.execPath },
  });

  const writer = new BoundedSender();
  const sent: DeviceFrame[] = [];
  let closes = 0;

  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string, callback: () => void) => {
      sent.push(JSON.parse(data));
      callback();
    },
    close: () => {
      closes++;
    },
  };

  const relay = new RuntimeProfileRelay(
    runtime,
    () => 'epoch',
    (frame) => writer.send(socket, frame),
  );

  const exchange = async (request: ProfileRequest) => {
    await relay.receive({
      type: FrameType.ProfilesRequest,
      requestId: randomUUID(),
      epoch: 'epoch',
      request,
    });

    return sent.at(-1);
  };

  try {
    let offset = 0;
    let revision: string | undefined;
    const ids: string[] = [];

    do {
      const frame = await exchange({
        kind: ProfileRequestKind.ListPage,
        offset,
        ...(revision ? { revision } : {}),
      });

      expect(frame?.type === FrameType.ProfilesResult && frame.reply.ok).toBe(true);

      if (
        frame?.type !== FrameType.ProfilesResult ||
        !frame.reply.ok ||
        frame.reply.response.kind !== ProfileRequestKind.ListPage
      ) {
        throw new Error('missing page');
      }

      const page = frame.reply.response;

      ids.push(...page.data.profiles.map((profile) => profile.id));
      expect(page.data.profiles.every((profile) => profile.models.length === 100)).toBe(true);
      revision = page.revision;
      offset = page.nextOffset ?? 0;
      expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(ProfileLimits.ResponseBytes);
    } while (offset);

    expect(new Set(ids).size).toBe(ProfileLimits.ActiveProfiles);

    const combined = await readProfilePages(async (request) => {
      const frame = await exchange(request);

      if (frame?.type !== FrameType.ProfilesResult || !frame.reply.ok) {
        throw new Error(ErrorCode.INVALID_FRAME);
      }

      return frame.reply.response;
    });

    expect(combined.data.profiles).toEqual(service.list().profiles);
    const oversized = await exchange({ kind: ProfileRequestKind.List });

    expect(oversized).toMatchObject({ reply: { ok: false, code: ErrorCode.LOCAL_PAYLOAD_TOO_LARGE } });
    expect(closes).toBe(0);
  } finally {
    await runtime.close();
  }
});
