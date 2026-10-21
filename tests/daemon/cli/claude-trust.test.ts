import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trustProjectsRoot } from '@daemon/cli/supervisor/claude-trust.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function config(content?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'claude-trust-'));

  roots.push(root);

  const path = join(root, '.claude.json');

  if (content !== undefined) {
    await writeFile(path, JSON.stringify(content));
  }

  return path;
}

it('trusts the projects root once, keeping every other setting, so Claude asks about no project under it', async () => {
  const path = await config({
    theme: 'dark',
    projects: { '/data/projects/app': { allowedTools: ['Bash'], hasTrustDialogAccepted: false } },
  });

  expect(await trustProjectsRoot(path, '/data/projects')).toBe(true);
  expect(await trustProjectsRoot(path, '/data/projects')).toBe(false);

  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
    theme: 'dark',
    projects: {
      '/data/projects/app': { allowedTools: ['Bash'], hasTrustDialogAccepted: false },
      '/data/projects': { hasTrustDialogAccepted: true },
    },
  });
});

it('starts a config when Claude has none yet, and leaves an unreadable one alone', async () => {
  const fresh = await config();

  expect(await trustProjectsRoot(fresh, '/data/projects')).toBe(true);

  expect(JSON.parse(await readFile(fresh, 'utf8'))).toEqual({
    projects: { '/data/projects': { hasTrustDialogAccepted: true } },
  });

  const broken = await config();

  await writeFile(broken, '{ not json');
  await expect(trustProjectsRoot(broken, '/data/projects')).rejects.toThrow();
  expect(await readFile(broken, 'utf8')).toBe('{ not json');
});
