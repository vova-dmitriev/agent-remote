import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterRegistry, SourceAdapter } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { UserInputBroker } from '@daemon/commands/user-input-broker.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { ProviderFilterValue } from '@protocol';

function fixture(store = new LocalStore(':memory:', 'device')) {
  const adapters = new AdapterRegistry('device');
  const permissions = new PermissionBroker();
  const userInputs = new UserInputBroker();

  const adapter = new SourceAdapter({
    connectorId: 'native',
    kind: 'claude-code-cli',
    transport: 'hooks',
    sourceVersion: 'test',
    capabilities: {
      observe: true,
      history: true,
      prompt: false,
      interrupt: false,
      permission: true,
      userInput: true,
      terminalSnapshot: false,
    },
    state: 'ready',
    reason: null,
  });

  adapters.register(adapter);
  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions, userInputs });
  const ids = new Map<number, string>();

  for (let index = 1; index <= 32; index++) {
    const id = `session-${String(index).padStart(3, '0')}`;

    monitor.ingestHook({ hook_event_name: 'SessionStart', session_id: id }, 'native');
    const session = monitor.findClaude('native', id)!;

    monitor.setSessionActivity(session.id, session.generation, Date.now() + index);
    ids.set(index, session.id);
  }

  return { store, permissions, userInputs, monitor, ids };
}

it('does not write the full catalog on snapshots and persists activity for paging across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-snapshot-pages-'));
  const path = join(directory, 'state.sqlite');
  let store = new LocalStore(path, 'device');
  const { monitor, permissions, userInputs, ids } = fixture(store);

  try {
    let catalogWrites = 0;
    const saveListedSession = store.saveListedSession.bind(store);

    store.saveListedSession = (session) => {
      catalogWrites++;
      saveListedSession(session);
    };

    monitor.snapshot();
    expect(catalogWrites).toBe(0);

    const newest = monitor.session(ids.get(1)!)!;

    monitor.setSessionActivity(newest.id, newest.generation, Date.now() + 100_000);
    expect(catalogWrites).toBe(1);

    userInputs.close();
    permissions.close();
    store.close();
    store = new LocalStore(path, 'device');

    expect(store.sessionPage(ProviderFilterValue.All).sessions[0]?.id).toBe(newest.id);
  } finally {
    userInputs.close();
    permissions.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps snapshot pending rows generation-matched to emitted sessions', () => {
  const { store, permissions, userInputs, monitor, ids } = fixture();

  try {
    const selected = monitor.session(ids.get(1)!)!;
    const omitted = monitor.session(ids.get(2)!)!;

    const inputSession = (sessionId: string, generation: string, requestId: string) => ({
      requestId,
      sessionId,
      generation,
      turnId: 'turn',
      itemId: 'item',
      questions: [
        {
          id: 'choice',
          header: 'Choice',
          question: 'Choose',
          isOther: false,
          isSecret: false,
          options: [{ label: 'A', description: '' }],
        },
      ],
      isBlocking: true,
      expiresAt: Date.now() + 60_000,
    });

    void userInputs.open(inputSession(omitted.id, omitted.generation, 'input-omitted'), () => {});
    void userInputs.open(inputSession(selected.id, selected.generation, 'input-selected'), () => {});
    void userInputs.open(inputSession(selected.id, 'stale-generation', 'input-stale'), () => {});

    void permissions.open({
      requestId: 'permission-omitted',
      sessionId: omitted.id,
      generation: omitted.generation,
      toolName: 'Bash',
      input: {},
      expiresAt: Date.now() + 60_000,
    });

    void permissions.open({
      requestId: 'permission-selected',
      sessionId: selected.id,
      generation: selected.generation,
      toolName: 'Bash',
      input: {},
      expiresAt: Date.now() + 60_000,
    });

    void permissions.open({
      requestId: 'permission-stale',
      sessionId: selected.id,
      generation: 'stale-generation',
      toolName: 'Bash',
      input: {},
      expiresAt: Date.now() + 60_000,
    });

    monitor.select(selected.id);
    const snapshot = monitor.snapshot();
    const sessionById = new Map(snapshot.sessions.map((session) => [session.id, session]));

    expect(sessionById.has(selected.id)).toBe(true);
    expect(sessionById.has(omitted.id)).toBe(false);

    expect(snapshot.permissions).toEqual([
      expect.objectContaining({ sessionId: selected.id, generation: selected.generation }),
    ]);

    expect(snapshot.userInputs).toEqual([
      expect.objectContaining({ sessionId: selected.id, generation: selected.generation }),
    ]);

    expect(
      snapshot.permissions.every(
        (pending) => sessionById.get(pending.sessionId)?.generation === pending.generation,
      ),
    ).toBe(true);

    expect(
      snapshot.userInputs?.every(
        (pending) => sessionById.get(pending.sessionId)?.generation === pending.generation,
      ),
    ).toBe(true);
  } finally {
    userInputs.close();
    permissions.close();
    store.close();
  }
});

it('continues paging from the contiguous recent prefix when an older session is selected', () => {
  const { store, monitor, permissions, userInputs, ids } = fixture();

  try {
    monitor.select(ids.get(1)!);
    const snapshot = monitor.snapshot();
    const cursor = snapshot.sessionPages?.all.cursor;

    expect(cursor).toBeTruthy();

    const nextPage = store.sessionPage(ProviderFilterValue.All, cursor ?? undefined);

    expect(snapshot.sessions).toHaveLength(30);
    expect(snapshot.sessions.map((session) => session.id)).toContain(ids.get(1));
    expect(nextPage.sessions.map((session) => session.id)).toEqual([ids.get(3), ids.get(2), ids.get(1)]);
    expect(nextPage.sessions.map((session) => session.id)).toContain(ids.get(2));
  } finally {
    userInputs.close();
    permissions.close();
    store.close();
  }
});
