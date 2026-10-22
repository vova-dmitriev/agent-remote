import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import Sqlite from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentProvider, CommandActionType, ErrorCode } from '@protocol';
import { ProjectSessions } from '@daemon/sessions/projects/project-sessions.js';
import { claudeConversation, recentFolders } from '@daemon/sessions/projects/recent-folders.js';

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

it("offers a Mac's recent session folders from Claude's and Codex's history, newest first, while they exist", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'recent-folders-')));

  roots.push(home);

  const folder = (name: string) => join(home, 'work', name);

  const [claudeOld, claudeNew, codex, gone] = [
    folder('claude-old'),
    folder('claude-new'),
    folder('codex'),
    folder('gone'),
  ];

  for (const folder of [claudeOld, claudeNew, codex]) {
    await mkdir(folder, { recursive: true });
  }

  const transcript = async (project: string, cwd: string, at: number) => {
    await mkdir(join(home, 'claude', 'projects', project), { recursive: true });
    const file = join(home, 'claude', 'projects', project, 'synthetic.jsonl');

    await writeFile(
      file,
      JSON.stringify({ type: 'summary' }) + '\n' + JSON.stringify({ type: 'user', cwd }) + '\n',
    );

    await utimes(file, at, at);
  };

  await transcript('old', claudeOld, 1_000);
  await transcript('new', claudeNew, 3_000);
  await transcript('gone', gone, 4_000);

  const db = new Sqlite(join(home, 'state_5.sqlite'));

  db.exec('CREATE TABLE threads(cwd TEXT, archived INTEGER, updated_at_ms INTEGER)');
  db.prepare('INSERT INTO threads VALUES(?,?,?)').run(codex, 0, 2_000_000);
  db.prepare('INSERT INTO threads VALUES(?,?,?)').run(join(home, 'work', 'archived'), 1, 9_000_000);
  db.close();

  const setProjects = vi.fn();
  const create = vi.fn(async () => 'new-session');

  const projects = new ProjectSessions({
    root: undefined,
    recent: () => recentFolders({ claudeDirectory: join(home, 'claude'), codexHome: home }),
    monitor: { setProjects },
    create,
  });

  await projects.refresh();

  expect(setProjects).toHaveBeenLastCalledWith([claudeNew, codex, claudeOld]);
  await expect(projects.create({ provider: AgentProvider.Claude, cwd: codex })).resolves.toBe('new-session');

  await expect(projects.create({ provider: AgentProvider.Claude, cwd: gone })).rejects.toMatchObject({
    code: ErrorCode.INVALID_PROJECT,
  });
});

it('finds a Claude conversation to continue with the folder it ran in, and none Claude never wrote', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'claude-conversation-')));

  roots.push(home);
  await mkdir(join(home, 'projects', 'synthetic-project'), { recursive: true });

  await writeFile(
    join(home, 'projects', 'synthetic-project', 'written.jsonl'),
    JSON.stringify({ type: 'user', cwd: '/synthetic/work' }) + '\n',
  );

  await expect(claudeConversation(home, 'written')).resolves.toEqual({
    path: join(home, 'projects', 'synthetic-project', 'written.jsonl'),
    cwd: '/synthetic/work',
  });

  await expect(claudeConversation(home, 'never-written')).resolves.toBeUndefined();
});
