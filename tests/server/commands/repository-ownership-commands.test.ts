import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttachmentRepository } from '../../../apps/server/src/attachments/repositories/attachments.js';
import { CommandRepository } from '../../../apps/server/src/commands/repositories/audit.js';
import { CommandClaimRepository } from '../../../apps/server/src/commands/repositories/claims.js';
import { NotificationRepository } from '../../../apps/server/src/notifications/repositories/notifications.js';
import { ownershipFixture } from '../../helpers/ownership-fixture.js';

// Attachments, commands and notifications: every owner-scoped repository method, called as owner B with owner A's
// ids, returns nothing and changes nothing.

let f: Awaited<ReturnType<typeof ownershipFixture>>;

beforeAll(async () => {
  f = await ownershipFixture();
});

afterAll(async () => {
  await f?.close();
});

describe('AttachmentRepository', () => {
  const attachments = () => new AttachmentRepository(f.db);
  const scopeA = () => ({ ownerId: f.ownerA, deviceId: f.deviceA, sessionId: f.sessionA });
  const foreign = () => ({ ownerId: f.ownerB, deviceId: f.deviceA, sessionId: f.sessionA });
  const file = () => ({ sha256: f.blobA, name: 'a.bin', mimeType: 'application/octet-stream' });

  const inTransaction = <T>(run: (repository: AttachmentRepository, tx: never) => Promise<T>) =>
    f.db.transaction((tx) => run(attachments(), tx as never));

  it('session', async () => {
    expect(await attachments().session(scopeA())).toBeDefined();
    expect(await attachments().session(foreign())).toBeUndefined();
  });

  it('sessionDevice', async () => {
    expect(await attachments().sessionDevice(f.ownerA, f.sessionA)).toBe(f.deviceA);
    expect(await attachments().sessionDevice(f.ownerB, f.sessionA)).toBeUndefined();
  });

  it('shareDevice', async () => {
    expect(await inTransaction((repository, tx) => repository.shareDevice(tx, f.ownerA, f.deviceA))).toBe(
      true,
    );

    expect(await inTransaction((repository, tx) => repository.shareDevice(tx, f.ownerB, f.deviceA))).toBe(
      false,
    );
  });

  it('sessionData', async () => {
    expect(await inTransaction((repository, tx) => repository.sessionData(tx, scopeA()))).toBeDefined();
    expect(await inTransaction((repository, tx) => repository.sessionData(tx, foreign()))).toBeUndefined();
  });

  it('stored', async () => {
    expect(
      await inTransaction((repository, tx) => repository.stored(tx, f.ownerA, f.attachmentA)),
    ).toBeDefined();

    expect(
      await inTransaction((repository, tx) => repository.stored(tx, f.ownerB, f.attachmentA)),
    ).toBeUndefined();
  });

  it('setSource', async () => {
    const { before, after } = await f.untouched('attachments', () =>
      inTransaction((repository, tx) =>
        repository.setSource(tx, f.ownerB, f.attachmentA, 'foreign', 'position:b'),
      ),
    );

    expect(after).toBe(before);
  });

  it('keepSource', async () => {
    const { before, after } = await f.untouched('attachments', () =>
      inTransaction((repository, tx) => repository.keepSource(tx, f.ownerB, f.attachmentA, 'foreign', null)),
    );

    expect(after).toBe(before);
  });

  it('hasBlob', async () => {
    expect(await inTransaction((repository, tx) => repository.hasBlob(tx, f.ownerA, f.blobA))).toBe(true);
    expect(await inTransaction((repository, tx) => repository.hasBlob(tx, f.ownerB, f.blobA))).toBe(false);
  });

  it('delete', async () => {
    const { before, after } = await f.untouched('attachments', () =>
      inTransaction((repository, tx) => repository.delete(tx, f.ownerB, f.attachmentA)),
    );

    expect(after).toBe(before);
  });

  it('deleteExpired', async () => {
    const { before, after } = await f.untouched('attachments', () =>
      inTransaction((repository, tx) => repository.deleteExpired(tx, f.ownerB, Number.MAX_SAFE_INTEGER)),
    );

    expect(after).toBe(before);
  });

  it('knownExport', async () => {
    expect(
      await inTransaction((repository, tx) => repository.knownExport(tx, scopeA(), file(), 0)),
    ).toBeDefined();

    expect(
      await inTransaction((repository, tx) => repository.knownExport(tx, foreign(), file(), 0)),
    ).toBeUndefined();
  });

  it('read', async () => {
    expect(await attachments().read(scopeA(), f.attachmentA)).toBeDefined();
    expect(await attachments().read(foreign(), f.attachmentA)).toBeUndefined();
  });

  it('available', async () => {
    expect(await attachments().available(scopeA(), f.attachmentA, 0)).toBe(true);
    expect(await attachments().available(foreign(), f.attachmentA, 0)).toBe(false);
  });

  it('source', async () => {
    expect(await attachments().source(scopeA(), f.attachmentA, 0)).toBeDefined();
    expect(await attachments().source(foreign(), f.attachmentA, 0)).toBeUndefined();
  });

  it('descriptors', async () => {
    expect(await attachments().descriptors(scopeA(), [f.attachmentA])).toHaveLength(1);
    expect(await attachments().descriptors(foreign(), [f.attachmentA])).toEqual([]);
  });

  it('pruneBlobs', async () => {
    const { before, after } = await f.untouched('attachment_blobs', () =>
      inTransaction((repository, tx) => repository.pruneBlobs(tx, f.ownerB)),
    );

    expect(after).toBe(before);
    expect(after).toContain(f.orphanBlobA);
  });

  it('usage', async () => {
    expect(await inTransaction((repository, tx) => repository.usage(tx, f.ownerA))).toBeGreaterThan(0);
    expect(await inTransaction((repository, tx) => repository.usage(tx, f.ownerB))).toBe(0);
  });

  it('evictable', async () => {
    expect(await inTransaction((repository, tx) => repository.evictable(tx, f.ownerA))).toHaveLength(1);
    expect(await inTransaction((repository, tx) => repository.evictable(tx, f.ownerB))).toEqual([]);
  });

  it('evict', async () => {
    const blobs = await f.untouched('attachment_blobs', () =>
      inTransaction((repository, tx) => repository.evict(tx, f.ownerB, [f.blobA])),
    );

    expect(blobs.after).toBe(blobs.before);
    expect(await attachments().read(scopeA(), f.attachmentA)).toBeDefined();
  });
});

describe('CommandRepository', () => {
  const commands = () => new CommandRepository(f.db);

  it('status', async () => {
    expect(await commands().status(f.ownerA, f.commandA)).toBeDefined();
    expect(await commands().status(f.ownerB, f.commandA)).toBeUndefined();
  });

  it('find', async () => {
    expect(await commands().find(f.ownerA, f.commandA)).toBeDefined();
    expect(await commands().find(f.ownerB, f.commandA)).toBeUndefined();
  });

  it('handoffDevice', async () => {
    expect(await commands().handoffDevice(f.ownerA, f.operationA)).toBe(f.deviceA);
    expect(await commands().handoffDevice(f.ownerB, f.operationA)).toBeUndefined();
  });

  it('setOutcome', async () => {
    const { before, after } = await f.untouched('command_audit', () =>
      commands().setOutcome(f.ownerB, f.commandA, 'rejected', 'DEVICE_OFFLINE'),
    );

    expect(after).toBe(before);
  });

  it('createdSession', async () => {
    expect(await commands().createdSession(f.ownerA, f.deviceA, f.sessionA, f.commandA)).toBe(true);
    expect(await commands().createdSession(f.ownerB, f.deviceA, f.sessionA, f.commandA)).toBe(false);
  });

  it('recordResult', async () => {
    const result = {
      deviceId: f.deviceA,
      commandId: f.commandA,
      status: 'dispatched',
      code: null,
      sessionId: null,
    };

    const before = await f.snapshotOf('command_audit');

    expect(await commands().recordResult({ ...result, ownerId: f.ownerB })).toBe(false);
    expect(await f.snapshotOf('command_audit')).toBe(before);
  });
});

describe('CommandClaimRepository', () => {
  it('lockHandoffOperation', async () => {
    const claims = new CommandClaimRepository();

    expect(
      await f.db.transaction((tx) => claims.lockHandoffOperation(tx, f.ownerA, f.deviceA, f.operationA)),
    ).toBeDefined();

    expect(
      await f.db.transaction((tx) => claims.lockHandoffOperation(tx, f.ownerB, f.deviceA, f.operationA)),
    ).toBeUndefined();
  });
});

describe('NotificationRepository', () => {
  const outbox = () => new NotificationRepository(f.db);

  it('session', async () => {
    expect(await f.db.transaction((tx) => outbox().session(tx, f.ownerA, f.sessionA))).toBeDefined();
    expect(await f.db.transaction((tx) => outbox().session(tx, f.ownerB, f.sessionA))).toBeUndefined();
  });

  it('latestTurn', async () => {
    const latest = (owner: string) =>
      f.db.transaction((tx) => outbox().latestTurn(tx, owner, f.deviceA, f.sessionA, String(Date.now())));

    expect(await latest(f.ownerA)).toHaveLength(1);
    expect(await latest(f.ownerB)).toEqual([]);
  });
});
