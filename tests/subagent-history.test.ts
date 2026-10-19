import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ActivityKind,
  FrameType,
  HistoryDirection,
  noCapabilities,
  SubagentStatus,
  ToolActivityPhase,
  type HistoryRead,
} from '@protocol';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { TranscriptSources } from '../apps/daemon/src/monitor/history.js';
import { AdapterRegistry, SourceAdapter } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';

const PARENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const cleanup: (() => unknown)[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const step of cleanup.splice(0).reverse()) {
    await step();
  }
});

const row = (uuid: string, type: 'user' | 'assistant', content: unknown, sessionId = PARENT) =>
  JSON.stringify({
    type,
    uuid,
    sessionId,
    isSidechain: true,
    timestamp: new Date(1_000).toISOString(),
    message: { content },
  }) + '\n';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'subagent-history-'));

  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'projects', 'synthetic');
  const parentPath = join(project, `${PARENT}.jsonl`);

  await mkdir(join(project, PARENT, 'subagents'), { recursive: true });
  await writeFile(parentPath, row('parent-1', 'user', 'Synthetic parent prompt'));

  const agent = async (
    id: string,
    meta: Record<string, unknown> | null,
    lines: string | null = row(`${id}-1`, 'user', 'Synthetic subagent task'),
    session = PARENT,
  ) => {
    const directory = join(project, session, 'subagents');

    await mkdir(directory, { recursive: true });

    if (lines !== null) {
      await writeFile(join(directory, `agent-${id}.jsonl`), lines);
    }

    if (meta) {
      await writeFile(join(directory, `agent-${id}.meta.json`), JSON.stringify(meta));
    }

    return directory;
  };

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  cleanup.push(() => {
    permissions.close();
    store.close();
  });

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      capabilities: { ...noCapabilities, observe: true, history: true },
      state: 'ready',
      reason: null,
    }),
  );

  const sources = (owner: Monitor) =>
    new TranscriptSources(root, undefined, undefined, 100, {
      ids: (id, generation) => {
        const session = owner.session(id);

        return session?.generation === generation ? (session.subagents ?? []).map((agent) => agent.id) : [];
      },
      merge: (id, generation, found) => owner.backfillSubagents(id, generation, found),
    });

  /** A new daemon process over the same store: native sessions come back restored. */
  const restart = () => new Monitor({ deviceId: 'device', store, adapters, permissions });
  const monitor = restart();
  const readers = sources(monitor);

  const session = () => monitor.snapshot().sessions[0]!;

  const start = async () => {
    monitor.ingestHook(
      { hook_event_name: 'SessionStart', session_id: PARENT, transcript_path: parentPath },
      'native',
    );

    readers.open(session().id, session().generation, parentPath, PARENT);
    await readers.refreshSubagents(session().id);
  };

  const read = (
    agentId: string | undefined,
    direction: HistoryRead['direction'] = HistoryDirection.Latest,
    anchor?: string,
  ) =>
    readers.page({
      type: FrameType.HistoryRead,
      requestId: 'request',
      sessionId: session().id,
      generation: session().generation,
      direction,
      ...(agentId === undefined ? {} : { agentId }),
      ...(anchor ? { anchor } : {}),
    });

  return { root, project, parentPath, agent, monitor, readers, session, start, read, sources, restart };
}

it('backfills finished and unfinished subagents from meta files when the session is first observed', async () => {
  const { agent, start, session } = await fixture();

  await agent('a0000000000000001', {
    agentType: 'reviewer',
    description: 'Synthetic review',
    model: 'synthetic-model',
    finished: true,
  });

  await agent('a0000000000000002', { agentType: 'explorer', description: 'Synthetic search' });
  await agent('a0000000000000003', { agentType: 'writer' }, null);
  // Internal side agents leave no meta file and are not listed.
  await agent('a0000000000000004', null);

  await start();

  const agents = session().subagents ?? [];

  expect(agents.map((child) => child.id).sort()).toEqual([
    'a0000000000000001',
    'a0000000000000002',
    'a0000000000000003',
  ]);

  expect(agents.find((child) => child.id === 'a0000000000000001')).toMatchObject({
    name: 'reviewer',
    type: 'reviewer',
    description: 'Synthetic review',
    model: 'synthetic-model',
    status: SubagentStatus.Completed,
    transcriptAvailable: true,
  });

  expect(agents.find((child) => child.id === 'a0000000000000002')).toMatchObject({
    type: 'explorer',
    status: SubagentStatus.Unknown,
    transcriptAvailable: true,
  });

  expect(agents.find((child) => child.id === 'a0000000000000003')?.transcriptAvailable).toBe(false);
});

it('keeps the newest 50 meta files and lets a finished file complete only an unknown child', async () => {
  const { agent, start, session, monitor, read } = await fixture();

  for (let index = 0; index < 52; index += 1) {
    const id = `b${String(index).padStart(16, '0')}`;
    const directory = await agent(id, { agentType: 'worker', finished: true });
    const time = new Date(1_700_000_000_000 + index * 1_000);

    await utimes(join(directory, `agent-${id}.meta.json`), time, time);
    await utimes(join(directory, `agent-${id}.jsonl`), time, time);
  }

  await start();
  const ids = (session().subagents ?? []).map((child) => child.id);

  expect(ids).toHaveLength(50);
  expect(ids).not.toContain('b0000000000000000');
  expect(ids).not.toContain('b0000000000000001');

  monitor.ingestHook(
    {
      hook_event_name: 'SubagentStart',
      session_id: PARENT,
      agent_id: 'b0000000000000051',
      agent_type: 'worker',
    },
    'native',
  );

  // Opening the view after the rescan interval re-lists the directory; the stale finished flag does
  // not override a live start.
  vi.setSystemTime(Date.now() + 6_000);
  await read('b0000000000000051');

  expect(session().subagents?.find((child) => child.id === 'b0000000000000051')?.status).toBe(
    SubagentStatus.Running,
  );
});

it('does not list an untyped internal side agent from its start or stop hooks', async () => {
  const { start, monitor, session } = await fixture();

  await start();

  for (const hook_event_name of ['SubagentStart', 'SubagentStop']) {
    monitor.ingestHook({ hook_event_name, session_id: PARENT, agent_id: 'a00000000000000ff' }, 'native');
  }

  expect(session().subagents ?? []).toEqual([]);
});

it('reads a listed subagent transcript with tool activity while the parent page stays text only', async () => {
  const { agent, start, read } = await fixture();

  await agent(
    'a0000000000000001',
    { agentType: 'reviewer' },
    row('s-1', 'user', 'Synthetic subagent task') +
      row('s-2', 'assistant', [
        { type: 'text', text: 'Looking around' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls synthetic' } },
        { type: 'tool_use', id: 'toolu_2', name: 'constructor', input: {} },
      ]) +
      row('s-3', 'user', [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'SYNTHETIC-RESULT-OUTPUT' },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          is_error: true,
          content: [{ type: 'text', text: 'SYNTHETIC-RESULT-ERROR' }],
        },
      ]),
  );

  await start();
  const page = await read('a0000000000000001');

  expect(page.messages.map(({ id, role, text, tool }) => ({ id, role, text, tool }))).toEqual([
    { id: 's-1', role: 'user', text: 'Synthetic subagent task', tool: undefined },
    { id: 's-2', role: 'assistant', text: 'Looking around', tool: undefined },
    {
      id: 's-2/1',
      role: 'assistant',
      text: 'ls synthetic',
      tool: { id: 'toolu_1', phase: ToolActivityPhase.Started, name: 'Bash', kind: ActivityKind.Command },
    },
    {
      id: 's-2/2',
      role: 'assistant',
      text: 'constructor',
      tool: { id: 'toolu_2', phase: ToolActivityPhase.Started, name: 'constructor', kind: ActivityKind.Tool },
    },
    { id: 's-3/0', role: 'user', text: '', tool: { id: 'toolu_1', phase: ToolActivityPhase.Completed } },
    { id: 's-3/1', role: 'user', text: '', tool: { id: 'toolu_2', phase: ToolActivityPhase.Failed } },
  ]);

  // A tool result's output never reaches any history item, in any field.
  for (const direction of [HistoryDirection.Latest, HistoryDirection.Around]) {
    const serialized = JSON.stringify((await read('a0000000000000001', direction)).messages);

    expect(serialized).not.toContain('SYNTHETIC-RESULT-OUTPUT');
    expect(serialized).not.toContain('SYNTHETIC-RESULT-ERROR');
  }

  const parent = await read(undefined);

  expect(parent.messages.map((message) => message.id)).toEqual(['parent-1']);
  expect(parent.messages.every((message) => message.tool === undefined)).toBe(true);
});

it('pages a tool-heavy subagent transcript without losing items at page edges', async () => {
  const { agent, start, read } = await fixture();
  let lines = '';

  for (let index = 0; index < 90; index += 1) {
    lines += row(`r-${index}`, 'assistant', [
      { type: 'tool_use', id: `toolu_${index}_a`, name: 'Read', input: { file_path: '/synthetic' } },
      { type: 'tool_use', id: `toolu_${index}_b`, name: 'Grep', input: { pattern: 'synthetic' } },
      { type: 'tool_use', id: `toolu_${index}_c`, name: 'Glob', input: { pattern: '*.ts' } },
    ]);
  }

  await agent('a0000000000000001', { agentType: 'reviewer' }, lines);
  await start();

  const seen: string[] = [];
  let page = await read('a0000000000000001');

  for (;;) {
    expect(page.messages.length).toBeLessThanOrEqual(100);
    seen.unshift(...page.messages.map((message) => message.id));

    if (!page.before) {
      break;
    }

    page = await read('a0000000000000001', HistoryDirection.Before, page.before);
  }

  expect(seen).toHaveLength(270);
  expect(new Set(seen).size).toBe(270);
});

it('refuses unlisted, foreign, traversal and symlinked subagent transcripts', async () => {
  const { root, agent, start, read, monitor } = await fixture();
  const directory = await agent('a0000000000000001', { agentType: 'reviewer' });

  // A transcript without a meta file is not in the session's list.
  await agent('a0000000000000002', null);
  // Another session's child, listed only for that session.
  await agent('a0000000000000003', { agentType: 'reviewer' }, undefined, OTHER);
  await writeFile(join(root, 'outside.jsonl'), row('x-1', 'user', 'Synthetic outside'));
  await symlink(join(root, 'outside.jsonl'), join(directory, 'agent-a0000000000000005.jsonl'));

  await writeFile(
    join(directory, 'agent-a0000000000000005.meta.json'),
    JSON.stringify({ agentType: 'linked' }),
  );

  await symlink(
    join(directory, 'agent-a0000000000000001.jsonl'),
    join(directory, 'agent-a0000000000000006.jsonl'),
  );

  await writeFile(
    join(directory, 'agent-a0000000000000006.meta.json'),
    JSON.stringify({ agentType: 'linked' }),
  );

  await start();

  await expect(read('a0000000000000001')).resolves.toMatchObject({ messages: [expect.anything()] });
  await expect(read('a0000000000000002')).rejects.toThrow('NOT_FOUND');
  await expect(read('a0000000000000003')).rejects.toThrow('NOT_FOUND');

  for (const traversal of ['../x', '/etc/passwd', `../${OTHER}/subagents/agent-a0000000000000003`, '.']) {
    await expect(read(traversal)).rejects.toThrow('NOT_FOUND');
  }

  // Even a hook that names a foreign child only reaches this session's own directory.
  monitor.ingestHook(
    {
      hook_event_name: 'SubagentStart',
      session_id: PARENT,
      agent_id: 'a0000000000000003',
      agent_type: 'reviewer',
    },
    'native',
  );

  await expect(read('a0000000000000003')).rejects.toThrow('TRANSCRIPT_UNAVAILABLE');

  // Symlinked transcripts are refused whether they point outside or inside the directory.
  await expect(read('a0000000000000005')).rejects.toThrow('INVALID_TRANSCRIPT_FILE');
  await expect(read('a0000000000000006')).rejects.toThrow('INVALID_TRANSCRIPT_FILE');
});

it('refuses a symlinked subagents directory', async () => {
  const { project, agent, start, read, session, monitor } = await fixture();

  await agent('a0000000000000003', { agentType: 'reviewer' }, undefined, OTHER);
  await rm(join(project, PARENT), { recursive: true });
  await mkdir(join(project, PARENT));
  await symlink(join(project, OTHER, 'subagents'), join(project, PARENT, 'subagents'));
  await start();

  // Backfill does not list the other session's children through the link.
  expect(session().subagents ?? []).toEqual([]);
  await expect(read('a0000000000000003')).rejects.toThrow('NOT_FOUND');

  monitor.ingestHook(
    {
      hook_event_name: 'SubagentStart',
      session_id: PARENT,
      agent_id: 'a0000000000000003',
      agent_type: 'reviewer',
    },
    'native',
  );

  await expect(read('a0000000000000003')).rejects.toThrow('TRANSCRIPT_OUTSIDE_ROOT');
});

it('lets a finished meta file complete a child restored as unknown', async () => {
  const { agent, start, monitor, session, restart, sources, parentPath } = await fixture();

  await start();

  monitor.ingestHook(
    {
      hook_event_name: 'SubagentStart',
      session_id: PARENT,
      agent_id: 'a0000000000000001',
      agent_type: 'reviewer',
    },
    'native',
  );

  expect(session().subagents?.[0]?.status).toBe(SubagentStatus.Running);
  await agent('a0000000000000001', { agentType: 'reviewer', finished: true });

  const restored = restart();
  const restoredSession = () => restored.snapshot().sessions[0]!;

  expect(restoredSession().subagents?.[0]?.status).toBe(SubagentStatus.Unknown);
  const readers = sources(restored);

  readers.open(restoredSession().id, restoredSession().generation, parentPath, PARENT);
  await readers.refreshSubagents(restoredSession().id);

  expect(restoredSession().subagents?.[0]).toMatchObject({
    status: SubagentStatus.Completed,
    transcriptAvailable: true,
  });
});

it('skips malformed and oversized meta files', async () => {
  const { agent, start, session } = await fixture();
  const directory = await agent('a0000000000000001', { agentType: 'reviewer' });

  await agent('a0000000000000002', null);
  await writeFile(join(directory, 'agent-a0000000000000002.meta.json'), '{ not json');
  await agent('a0000000000000003', null);
  await writeFile(join(directory, 'agent-a0000000000000003.meta.json'), '["synthetic"]');
  await agent('a0000000000000004', { agentType: 'reviewer', description: 'x'.repeat(70 * 1024) });

  await start();
  expect((session().subagents ?? []).map((child) => child.id)).toEqual(['a0000000000000001']);
});

it('rescans the subagents directory at most once per interval', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const { agent, start, read, session } = await fixture();

  await start();
  await agent('a0000000000000001', { agentType: 'reviewer' });

  // A recent scan stands: neither the session page nor the view rescans, so the new child is unknown.
  await read(undefined);
  await expect(read('a0000000000000001')).rejects.toThrow('NOT_FOUND');
  expect(session().subagents ?? []).toEqual([]);

  vi.setSystemTime(Date.now() + 6_000);
  await expect(read('a0000000000000001')).resolves.toMatchObject({ messages: [expect.anything()] });
  expect((session().subagents ?? []).map((child) => child.id)).toEqual(['a0000000000000001']);
});

it('re-checks the subagents directory on every read of a cached transcript', async () => {
  const { project, agent, start, read } = await fixture();

  await agent('a0000000000000001', { agentType: 'reviewer' });
  await agent('a0000000000000001', { agentType: 'reviewer' }, undefined, OTHER);
  await start();
  await expect(read('a0000000000000001')).resolves.toMatchObject({ messages: [expect.anything()] });

  await rm(join(project, PARENT), { recursive: true });
  await mkdir(join(project, PARENT));
  await symlink(join(project, OTHER, 'subagents'), join(project, PARENT, 'subagents'));
  await expect(read('a0000000000000001', HistoryDirection.Around)).rejects.toThrow('TRANSCRIPT_OUTSIDE_ROOT');
});
