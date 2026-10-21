import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, TargetKind } from '@protocol';
import type { Session, TargetKind as TargetKindType } from '@protocol';
import type { MonitorPort } from '@daemon/domain/ports/monitor.js';
import type { NativeProcess, NativeProcesses } from '@daemon/sessions/native-process.js';
import { expect, it } from 'vitest';
import { SessionSkillsService } from '@daemon/skills/service.js';

const processRecord: NativeProcess = {
  pid: 32,
  sessionId: 'claude-1',
  cwd: '/work',
  procStart: 'same-process',
};

function session(id: string, cwd: string, kind: TargetKindType = TargetKind.ClaudeCodeCli): Session {
  const target =
    kind === TargetKind.Cmux
      ? {
          kind,
          deviceId: 'device-1',
          connectorId: 'surface-1',
          windowId: '00000000-0000-4000-8000-000000000001',
          workspaceId: '00000000-0000-4000-8000-000000000002',
          surfaceId: '00000000-0000-4000-8000-000000000003',
        }
      : { kind, deviceId: 'device-1', connectorId: 'connector-1', claudeSessionId: 'claude-1' };

  return {
    id,
    cwd,
    generation: 'generation-1',
    claudeSessionId: 'claude-1',
    target,
  } as unknown as Session;
}

function serviceFor(
  current: () => Session | undefined,
  context: { HOME: string; CLAUDE_CONFIG_DIR: string },
  resolve?: () => Promise<NativeProcess | undefined>,
  cmuxSurface?: () => Promise<{ workspaceId: string; surfaceId: string } | undefined>,
) {
  const monitor = { session: current } as unknown as Pick<MonitorPort, 'session'>;

  const native = {
    resolve: resolve ?? (async () => processRecord),
    capture: async () => ({ executable: '/claude', args: [], env: context }),
    cmuxSurface:
      cmuxSurface ??
      (async () => ({
        workspaceId: '00000000-0000-4000-8000-000000000002',
        surfaceId: '00000000-0000-4000-8000-000000000003',
      })),
  } as unknown as Pick<NativeProcesses, 'resolve' | 'capture' | 'cmuxSurface'>;

  return new SessionSkillsService(monitor, native);
}

it('binds metadata to the current session generation and native Claude process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-service-'));
  const home = join(root, 'profile');
  const cwd = join(root, 'project');
  const config = join(home, '.claude');
  const current = session('owner-a', cwd);

  try {
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(join(cwd, '.claude', 'skills', 'review'), { recursive: true });

    await writeFile(
      join(cwd, '.claude', 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review code\n---\nPRIVATE BODY',
    );

    const result = await serviceFor(() => current, { HOME: home, CLAUDE_CONFIG_DIR: config }).list(
      current.id,
      current.generation,
    );

    expect(result).toMatchObject({ sessionId: 'owner-a', generation: 'generation-1', supported: true });
    expect(result.skills.map(({ invocation }) => invocation)).toEqual(['/review']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE BODY');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('returns unsupported for a Codex session without resolving Claude authority', async () => {
  const current = session('codex-owner', '/work', TargetKind.CodexCli);
  let resolved = false;

  const service = serviceFor(
    () => current,
    { HOME: '/unused', CLAUDE_CONFIG_DIR: '/unused/.claude' },
    async () => {
      resolved = true;

      return undefined;
    },
  );

  expect(await service.list(current.id, current.generation)).toEqual({
    sessionId: 'codex-owner',
    generation: 'generation-1',
    supported: false,
    truncated: false,
    skills: [],
  });

  expect(resolved).toBe(false);
});

it('supports a real Cmux target only when the resolved Claude process owns that surface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-cmux-'));
  const home = join(root, 'profile');
  const cwd = join(root, 'project');
  const current = session('cmux-owner', cwd, TargetKind.Cmux);
  const service = serviceFor(() => current, { HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') });

  try {
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    const result = await service.list(current.id, current.generation);

    expect(result.supported).toBe(true);
    expect(result.sessionId).toBe('cmux-owner');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects a generation change that occurs during filesystem awaits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-stale-'));
  const home = join(root, 'profile');
  const cwd = join(root, 'project');
  const config = join(home, '.claude');
  const current = session('owner-a', cwd);
  let sessionReads = 0;

  const service = serviceFor(
    () => {
      sessionReads++;

      if (sessionReads === 7) {
        current.generation = 'generation-2';
      }

      return current;
    },
    { HOME: home, CLAUDE_CONFIG_DIR: config },
  );

  try {
    await mkdir(config, { recursive: true });
    await mkdir(join(cwd, '.claude', 'skills', 'review'), { recursive: true });

    await writeFile(
      join(cwd, '.claude', 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review code\n---\nBODY',
    );

    await expect(service.list(current.id, 'generation-1')).rejects.toMatchObject({
      code: ErrorCode.STALE_SESSION,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('revalidates the captured process at scan boundaries instead of rescanning it for each filesystem operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-process-fence-'));
  const home = join(root, 'profile');
  const cwd = join(root, 'project');
  const config = join(home, '.claude');
  const current = session('owner-a', cwd);
  let resolveCount = 0;

  const service = serviceFor(
    () => current,
    { HOME: home, CLAUDE_CONFIG_DIR: config },
    async () => {
      resolveCount++;

      return processRecord;
    },
  );

  try {
    await mkdir(config, { recursive: true });
    await mkdir(join(cwd, '.claude', 'skills', 'review'), { recursive: true });

    await writeFile(
      join(cwd, '.claude', 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review code\n---\nBODY',
    );

    const result = await service.list(current.id, current.generation);

    expect(result.supported).toBe(true);
    expect(resolveCount).toBe(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects a native process replacement that occurs during filesystem discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-process-replaced-'));
  const home = join(root, 'profile');
  const cwd = join(root, 'project');
  const config = join(home, '.claude');
  const current = session('owner-a', cwd);
  let resolveCount = 0;

  const service = serviceFor(
    () => current,
    { HOME: home, CLAUDE_CONFIG_DIR: config },
    async () => {
      resolveCount++;

      return resolveCount === 3 ? { ...processRecord, procStart: 'replacement-process' } : processRecord;
    },
  );

  try {
    await mkdir(config, { recursive: true });
    await mkdir(join(cwd, '.claude', 'skills', 'review'), { recursive: true });

    await writeFile(
      join(cwd, '.claude', 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review code\n---\nBODY',
    );

    await expect(service.list(current.id, current.generation)).rejects.toMatchObject({
      code: ErrorCode.STALE_SESSION,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects a Cmux surface change that occurs during filesystem discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-cmux-changed-'));
  const home = join(root, 'profile');
  const cwd = join(root, 'project');
  const config = join(home, '.claude');
  const current = session('cmux-owner', cwd, TargetKind.Cmux);
  let checks = 0;

  const service = serviceFor(
    () => current,
    { HOME: home, CLAUDE_CONFIG_DIR: config },
    undefined,
    async () => {
      checks++;

      return checks < 3
        ? {
            workspaceId: '00000000-0000-4000-8000-000000000002',
            surfaceId: '00000000-0000-4000-8000-000000000003',
          }
        : undefined;
    },
  );

  try {
    await mkdir(config, { recursive: true });
    await mkdir(cwd, { recursive: true });

    await expect(service.list(current.id, current.generation)).rejects.toMatchObject({
      code: ErrorCode.STALE_SESSION,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
