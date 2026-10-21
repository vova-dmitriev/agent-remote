import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentProvider, CommandActionType, ErrorCode } from '@protocol';
import { ProjectSessions } from '@daemon/sessions/project-sessions.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function projectsRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'projects-')));

  roots.push(root);
  await mkdir(join(root, 'beta'));
  await mkdir(join(root, 'alpha'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'notes.txt'), 'synthetic');

  return root;
}

it("lists the root's project directories on the snapshot and starts a session only in one of them", async () => {
  const root = await projectsRoot();
  const setProjects = vi.fn();
  const create = vi.fn(async () => 'new-session');
  const projects = new ProjectSessions({ root, monitor: { setProjects }, create });

  await projects.refresh();

  expect(setProjects).toHaveBeenLastCalledWith([join(root, 'alpha'), join(root, 'beta')]);

  await expect(
    projects.create({
      provider: AgentProvider.Codex,
      cwd: join(root, 'alpha'),
      model: { model: 'synthetic' },
    }),
  ).resolves.toBe('new-session');

  expect(create).toHaveBeenCalledWith({
    type: CommandActionType.CreateSession,
    provider: AgentProvider.Codex,
    cwd: join(root, 'alpha'),
    model: { model: 'synthetic' },
  });

  for (const cwd of [root, join(root, '.hidden'), join(root, 'alpha', '..', 'beta', '..', '..'), '/etc']) {
    await expect(projects.create({ provider: AgentProvider.Claude, cwd })).rejects.toMatchObject({
      code: ErrorCode.INVALID_PROJECT,
    });
  }

  expect(create).toHaveBeenCalledTimes(1);
});

it('offers no projects without a projects root', async () => {
  const setProjects = vi.fn();
  const projects = new ProjectSessions({ root: undefined, monitor: { setProjects }, create: vi.fn() });

  await projects.refresh();

  expect(setProjects).not.toHaveBeenCalled();

  await expect(projects.create({ provider: AgentProvider.Claude, cwd: '/tmp' })).rejects.toMatchObject({
    code: ErrorCode.INVALID_PROJECT,
  });
});
