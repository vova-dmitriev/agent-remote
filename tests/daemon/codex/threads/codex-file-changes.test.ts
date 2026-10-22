import { expect, it } from 'vitest';
import { CodexFileChanges, boundChangeSnapshots } from '@daemon/codex/binding/file-changes.js';
import { sessionChangesSchema, type Session } from '@protocol';

const item = (id: string, path = 'src/app.ts', diff = '@@ -1 +1 @@\n-old\n+const value = 2;') => ({
  id,
  type: 'fileChange',
  status: 'completed',
  changes: [{ path, kind: { type: 'update' }, diff }],
});

it('retains only completed native edits and deduplicates hydration without reading paths', () => {
  const changes = new CodexFileChanges();

  changes.ingest({ ...item('pending'), status: 'inProgress' }, 'turn');
  changes.ingest({ ...item('failed'), status: 'failed' }, 'turn');
  changes.ingest({ ...item('tool'), type: 'commandExecution' }, 'turn');
  expect(changes.value().files).toHaveLength(0);
  changes.ingest(item('edit'), 'turn');
  changes.ingest(item('edit', 'src/app.ts', 'stale'), 'turn', true);
  changes.ingest(item('other', '/not/a/readable/file.ts'), 'turn');
  expect(changes.value().files).toHaveLength(2);
  expect(changes.value().files[0]?.patch).toContain('+const value = 2;');
  expect(sessionChangesSchema.safeParse(changes.value()).success).toBe(true);
});

it('bounds escaped/multibyte patches and the shared snapshot payload', () => {
  const changes = new CodexFileChanges();

  for (let index = 0; index < 100; index++) {
    changes.ingest(item(String(index), `src/${index}.ts`, '\n"🔥'.repeat(20000)), 'turn');
  }

  const result = changes.value();

  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(16384);
  expect(result.truncated).toBe(true);
  expect(result.files.length).toBeGreaterThan(0);
  expect(result.files.at(-1)?.truncated).toBe(true);
  expect(sessionChangesSchema.safeParse(result).success).toBe(true);

  const sessions = Array.from(
    { length: 30 },
    (_, index) => ({ id: String(index), changes: result }) as Session,
  );

  const bounded = boundChangeSnapshots(sessions);

  expect(Buffer.byteLength(JSON.stringify(bounded.map((session) => session.changes)))).toBeLessThan(162_000); // the 160 KB budget plus each session's empty changes envelope
  expect(bounded.some((session) => !session.changes?.files.length && session.changes?.truncated)).toBe(true);
});

it('does not add diff payload when other snapshot content uses the transport budget', async () => {
  const { boundSnapshotChanges } = await import('@daemon/codex/binding/file-changes.js');
  const changes = new CodexFileChanges();

  changes.ingest(item('edit'), 'turn');

  const snapshot = {
    sessions: [{ id: 'session', changes: changes.value() } as Session],
    deviceStatus: 'online' as const,
    cursor: { streamId: 'synthetic', seq: 0 },
    permissions: [],
    terminal: { sessionId: 'session', generation: 'g', text: '\n'.repeat(240000), capturedAt: 0 },
  };

  const bounded = boundSnapshotChanges(snapshot);

  expect(bounded.sessions[0]?.changes?.files).toHaveLength(0);
  expect(bounded.sessions[0]?.changes?.truncated).toBe(true);
  expect(bounded.terminal?.text).toBe(snapshot.terminal.text);
});

it('records when Codex changed each file', () => {
  const changes = new CodexFileChanges();

  changes.ingest(item('edit'), 'turn', false, 1_792_000_000_000);

  expect(changes.value().files[0]?.changedAt).toBe(1_792_000_000_000);
  expect(sessionChangesSchema.safeParse(changes.value()).success).toBe(true);
});
