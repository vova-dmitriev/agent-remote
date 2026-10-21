import { expect, it } from 'vitest';
import Sqlite from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '@daemon/monitor/store.js';
import { ConnectorId, ProviderFilterValue, TargetKind, type Session } from '@protocol';
import { sessionSnapshot } from '../../../e2e/support/fixtures/session-fixtures.js';
import { codexFixtures } from '../../../e2e/support/fixtures/codex-fixtures.js';

const makeSession = (id: number, provider: ProviderFilterValue): Session => {
  const base = sessionSnapshot('device').sessions[0]!;
  const session = provider === ProviderFilterValue.Codex ? codexFixtures(base).sessions[0]! : base;

  return {
    ...session,
    id: 'session-' + String(id).padStart(3, '0'),
    lastMessageAt: Math.floor(id / 5) * 5,
    lastEventAt: id,
  };
};

it('pages more than 60 sessions newest first with stable ties and provider filtering', () => {
  const store = new LocalStore(':memory:', 'device');

  try {
    for (let index = 0; index < 75; index++) {
      const provider = index % 3 === 0 ? ProviderFilterValue.Codex : ProviderFilterValue.Claude;

      store.saveListedSession(makeSession(index, provider));
    }

    const pages = [store.sessionPage(ProviderFilterValue.All)];

    while (pages.at(-1)!.nextCursor) {
      pages.push(store.sessionPage(ProviderFilterValue.All, pages.at(-1)!.nextCursor!));
    }

    const all = pages.flatMap((page) => page.sessions);

    const expected = Array.from({ length: 75 }, (_, index) =>
      makeSession(index, index % 3 === 0 ? ProviderFilterValue.Codex : ProviderFilterValue.Claude),
    ).sort(
      (left, right) =>
        (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) || left.id.localeCompare(right.id),
    );

    expect(pages.map((page) => page.sessions.length)).toEqual([30, 30, 15]);
    expect(all.map((session) => session.id)).toEqual(expected.map((session) => session.id));
    expect(new Set(all.map((session) => session.id)).size).toBe(75);

    const codex = store.sessionPage(ProviderFilterValue.Codex);

    expect(codex.sessions.every((session) => session.target.kind === 'codex-cli')).toBe(true);
  } finally {
    store.close();
  }
});

it('keeps device pages isolated and rejects a cursor from another provider', () => {
  const first = new LocalStore(':memory:', 'first-device');
  const second = new LocalStore(':memory:', 'second-device');

  try {
    for (let index = 0; index < 31; index++) {
      const owned = makeSession(index, ProviderFilterValue.Claude);

      first.saveListedSession({ ...owned, target: { ...owned.target, deviceId: 'first-device' } });
      const foreign = makeSession(index + 100, ProviderFilterValue.Claude);

      second.saveListedSession({ ...foreign, target: { ...foreign.target, deviceId: 'second-device' } });
    }

    const cursor = first.sessionPage(ProviderFilterValue.Claude).nextCursor!;

    expect(first.sessionPage(ProviderFilterValue.Claude, cursor).sessions).toHaveLength(1);
    expect(() => second.sessionPage(ProviderFilterValue.Claude, cursor)).toThrow();
    expect(() => first.sessionPage(ProviderFilterValue.Codex, cursor)).toThrow();
  } finally {
    first.close();
    second.close();
  }
});

it('starts provider pages at that provider head when the All snapshot is mostly another provider', () => {
  const store = new LocalStore(':memory:', 'device');

  try {
    for (let index = 0; index < 75; index++) {
      store.saveListedSession(
        makeSession(index, index >= 45 ? ProviderFilterValue.Codex : ProviderFilterValue.Claude),
      );
    }

    const allSnapshotIds = store.sessionPage(ProviderFilterValue.All).sessions.map((session) => session.id);
    const claudePages = [store.sessionPage(ProviderFilterValue.Claude)];

    while (claudePages.at(-1)!.nextCursor) {
      claudePages.push(store.sessionPage(ProviderFilterValue.Claude, claudePages.at(-1)!.nextCursor!));
    }

    const claudeIds = claudePages.flatMap((page) => page.sessions.map((session) => session.id));

    expect(allSnapshotIds.every((id) => Number(id.slice(-3)) >= 45)).toBe(true);
    expect(claudePages.map((page) => page.sessions.length)).toEqual([30, 15]);

    expect(claudeIds).toEqual(
      Array.from({ length: 45 }, (_, index) => makeSession(index, ProviderFilterValue.Claude))
        .sort(
          (left, right) =>
            (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) || left.id.localeCompare(right.id),
        )
        .map((session) => session.id),
    );
  } finally {
    store.close();
  }
});

it('backfills the bounded metadata catalog from legacy native rows without opening every transcript', () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-page-backfill-')),
    path = join(directory, 'state.sqlite');

  const before = new LocalStore(path, 'device');

  for (let index = 0; index < 75; index++) {
    const source = makeSession(index, ProviderFilterValue.Claude);

    const native: Session = {
      ...source,
      target: {
        kind: TargetKind.ClaudeCodeCli,
        deviceId: 'device',
        connectorId: ConnectorId.Native,
        claudeSessionId: source.claudeSessionId!,
      },
    };

    before.saveNativeSession(native, `/transcripts/${native.id}.jsonl`);
  }

  before.close();

  const legacy = new Sqlite(path);

  legacy.prepare('DELETE FROM listed_sessions WHERE device_id=?').run('device');
  legacy.prepare('DELETE FROM metadata WHERE key=?').run('listedNativeBackfill');
  legacy.close();

  const restored = new LocalStore(path, 'device');

  try {
    expect(restored.nativeSessions()).toHaveLength(30);
    const check = new Sqlite(path);

    const catalogCount = (
      check.prepare('SELECT count(*) AS count FROM listed_sessions WHERE device_id=?').get('device') as {
        count: number;
      }
    ).count;

    check.close();
    expect(catalogCount).toBe(75);

    const pages = [restored.sessionPage(ProviderFilterValue.All)];

    while (pages.at(-1)!.nextCursor) {
      pages.push(restored.sessionPage(ProviderFilterValue.All, pages.at(-1)!.nextCursor!));
    }

    expect(pages.map((page) => page.sessions.length)).toEqual([30, 30, 15]);
    expect(pages.flatMap((page) => page.sessions).map((session) => session.id)).toHaveLength(75);
    expect(restored.nativeSessions()).toHaveLength(30);
    expect(restored.nativeSession('session-000')?.transcriptPath).toBe('/transcripts/session-000.jsonl');
  } finally {
    restored.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
