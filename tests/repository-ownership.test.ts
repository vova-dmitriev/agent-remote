import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeviceRepository } from '../apps/server/src/devices/repositories/devices.js';
import { PairingRepository } from '../apps/server/src/devices/repositories/pairings.js';
import { HistoryRepository } from '../apps/server/src/history/repository.js';
import { PreferenceRepository } from '../apps/server/src/preferences/repository.js';
import { ReadingPositionRepository } from '../apps/server/src/reading-position/repository.js';
import { SessionRepository } from '../apps/server/src/sessions/repository.js';
import { ownershipFixture } from './helpers/ownership-fixture.js';

// Every owner-scoped repository method, called as owner B with owner A's ids, returns nothing and changes nothing.

let f: Awaited<ReturnType<typeof ownershipFixture>>;

beforeAll(async () => {
  f = await ownershipFixture();
});

afterAll(async () => {
  await f?.close();
});

/** Runs a foreign write, which may also be refused by a foreign key, and returns owner A's rows before and after. */
async function unchanged(table: string, write: () => Promise<unknown>) {
  const before = await f.snapshotOf(table);

  await write().catch(() => undefined);

  return { before, after: await f.snapshotOf(table) };
}

describe('SessionRepository', () => {
  const sessions = () => new SessionRepository(f.db);

  it('deviceOf', async () => {
    expect(await sessions().deviceOf(f.ownerA, f.sessionA)).toBe(f.deviceA);
    expect(await sessions().deviceOf(f.ownerB, f.sessionA)).toBeUndefined();
  });

  it('exists', async () => {
    expect(await sessions().exists(f.ownerA, f.deviceA, f.sessionA)).toBe(true);
    expect(await sessions().exists(f.ownerB, f.deviceA, f.sessionA)).toBe(false);
  });

  it('labels', async () => {
    expect(await sessions().labels(f.ownerA, f.deviceA)).toHaveLength(1);
    expect(await sessions().labels(f.ownerB, f.deviceA)).toEqual([]);
  });

  it('activity', async () => {
    expect(await sessions().activity(f.ownerA, f.deviceA)).toHaveLength(1);
    expect(await sessions().activity(f.ownerB, f.deviceA)).toEqual([]);
  });

  it('lockLive', async () => {
    expect(await f.db.transaction((tx) => sessions().lockLive(tx, f.ownerA, f.sessionA))).toBeDefined();
    expect(await f.db.transaction((tx) => sessions().lockLive(tx, f.ownerB, f.sessionA))).toBeUndefined();
  });

  it('saveLabel', async () => {
    const { before, after } = await unchanged('session_labels', () =>
      f.db.transaction((tx) => sessions().saveLabel(tx, f.ownerB, f.deviceA, 'source-a', 'Foreign')),
    );

    expect(after).toBe(before);
  });

  it('setTitle', async () => {
    const { before, after } = await unchanged('sessions', () =>
      f.db.transaction((tx) => sessions().setTitle(tx, f.ownerB, f.deviceA, f.sessionA, 'Foreign')),
    );

    expect(after).toBe(before);
  });

  it('replaceAll', async () => {
    const { before, after } = await unchanged('sessions', () =>
      f.db.transaction((tx) => sessions().replaceAll(tx, f.ownerB, f.deviceA, [])),
    );

    expect(after).toBe(before);
  });
});

describe('DeviceRepository', () => {
  const devices = () => new DeviceRepository(f.db);

  it('owned', async () => {
    expect(await devices().owned(f.ownerA, f.deviceA)).toBeDefined();
    expect(await devices().owned(f.ownerB, f.deviceA)).toBeUndefined();
  });

  it('list', async () => {
    expect(await devices().list(f.ownerA)).toHaveLength(1);
    expect(await devices().list(f.ownerB)).toEqual([]);
  });

  it('hasActive', async () => {
    expect(await f.db.transaction((tx) => devices().hasActive(tx, f.ownerA))).toBe(true);
    expect(await f.db.transaction((tx) => devices().hasActive(tx, f.ownerB))).toBe(false);
  });

  it('revoke', async () => {
    const { before, after } = await unchanged('devices', () => devices().revoke(f.ownerB, f.deviceA, 1));

    expect(after).toBe(before);
  });

  it('touch', async () => {
    const { before, after } = await unchanged('devices', () => devices().touch(f.ownerB, f.deviceA, 99));

    expect(after).toBe(before);
  });

  it('saveSnapshot', async () => {
    const { before, after } = await unchanged('devices', () =>
      f.db.transaction((tx) => devices().saveSnapshot(tx, f.ownerB, f.deviceA, { owner: 'b' }, [])),
    );

    expect(after).toBe(before);
  });
});

describe('PairingRepository', () => {
  it('claim', async () => {
    const pairings = new PairingRepository(f.db);
    const before = await f.snapshotOf('pairings');

    expect(
      await f.db.transaction((tx) => pairings.claim(tx, f.ownerB, 'foreign-claim', f.codeHashA, Date.now())),
    ).toBeUndefined();

    expect(await f.snapshotOf('pairings')).toBe(before);
  });
});

describe('PreferenceRepository', () => {
  const preferences = () => new PreferenceRepository(f.db);

  it('find', async () => {
    expect(await preferences().find(f.ownerA)).toEqual({ language: 'en', theme: 'dark' });
    expect(await preferences().find(f.ownerB)).toBeUndefined();
  });

  it('save', async () => {
    const { before, after } = await unchanged('user_preferences', () =>
      preferences().save(f.ownerB, 'ru', 'light'),
    );

    expect(after).toBe(before);
  });
});

describe('ReadingPositionRepository', () => {
  const positions = () => new ReadingPositionRepository(f.db);

  it('sessionDevice', async () => {
    expect(await positions().sessionDevice(f.ownerA, f.sessionA)).toBe(f.deviceA);
    expect(await positions().sessionDevice(f.ownerB, f.sessionA)).toBeUndefined();

    expect(
      await f.db.transaction((tx) => positions().sessionDevice(f.ownerB, f.sessionA, tx)),
    ).toBeUndefined();
  });

  it('find', async () => {
    expect(await positions().find(f.ownerA, f.deviceA, f.sessionA)).toBeDefined();
    expect(await positions().find(f.ownerB, f.deviceA, f.sessionA)).toBeUndefined();
  });

  it('saveNewer', async () => {
    const { before, after } = await unchanged('reading_positions', () =>
      f.db.transaction((tx) =>
        positions().saveNewer(tx, f.ownerB, f.deviceA, f.sessionA, {
          messageId: 'foreign',
          offset: 0,
          updatedAt: Date.now(),
        }),
      ),
    );

    expect(after).toBe(before);
  });
});

describe('HistoryRepository', () => {
  const history = () => new HistoryRepository(f.db);
  const scopeA = () => ({ ownerId: f.ownerA, deviceId: f.deviceA, sessionId: f.sessionA });
  const foreign = () => ({ ownerId: f.ownerB, deviceId: f.deviceA, sessionId: f.sessionA });

  it('insertEvent', async () => {
    const { before, after } = await unchanged('events', () =>
      f.db.transaction((tx) =>
        history().insertEvent(tx, f.ownerB, {
          deviceId: f.deviceA,
          streamId: f.streamA,
          seq: 1,
          eventId: 'event-a',
          sessionId: f.sessionA,
          occurredAt: 1,
        } as never),
      ),
    );

    expect(after).toBe(before);
  });

  it('bumpRevision', async () => {
    const { before, after } = await unchanged('devices', () =>
      f.db.transaction((tx) => history().bumpRevision(tx, f.ownerB, f.deviceA)),
    );

    expect(after).toBe(before);
  });

  it('recordActivity', async () => {
    const { before, after } = await unchanged('session_activity', () =>
      f.db.transaction((tx) => history().recordActivity(tx, f.ownerB, f.deviceA, f.sessionA, 99)),
    );

    expect(after).toBe(before);
  });

  it('liveSession', async () => {
    expect(await history().liveSession(f.ownerA, f.sessionA)).toBeDefined();
    expect(await history().liveSession(f.ownerB, f.sessionA)).toBeUndefined();
  });

  it('sourceSession', async () => {
    expect(await history().sourceSession(f.ownerA, f.sessionA)).toBeDefined();
    expect(await history().sourceSession(f.ownerB, f.sessionA)).toBeUndefined();
  });

  it('message', async () => {
    expect(await history().message(scopeA(), f.messageA)).toBeDefined();
    expect(await history().message(foreign(), f.messageA)).toBeUndefined();
  });

  it('page', async () => {
    expect(await history().page(scopeA(), undefined, false, false)).toHaveLength(1);
    expect(await history().page(foreign(), undefined, false, false)).toEqual([]);
  });

  it('beyond', async () => {
    const boundary = {
      data: {} as never,
      event_id: 'z',
      occurred_at: '999',
      stream_id: 'z',
      seq: '999',
    };

    expect(await history().beyond(scopeA(), boundary, '<')).toBe(true);
    expect(await history().beyond(foreign(), boundary, '<')).toBe(false);
  });

  it('streamBounds', async () => {
    expect(await history().streamBounds(f.ownerA, f.deviceA, f.streamA)).toEqual({ min: '1', max: '1' });
    expect(await history().streamBounds(f.ownerB, f.deviceA, f.streamA)).toEqual({ min: null, max: null });
  });

  it('after', async () => {
    expect(await history().after(f.ownerA, f.deviceA, f.streamA, 0)).toHaveLength(1);
    expect(await history().after(f.ownerB, f.deviceA, f.streamA, 0)).toEqual([]);
  });
});
