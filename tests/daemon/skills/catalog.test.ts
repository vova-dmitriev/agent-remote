import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { discoverSessionSkills } from '@daemon/skills/catalog.js';

it('lists scoped user-invocable Claude skills and applies hidden and byte limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-'));
  const home = join(root, 'home');
  const cwd = join(root, 'project', 'repo');
  const outside = join(root, 'outside');

  const current = async () => {};

  try {
    await mkdir(join(home, '.claude', 'skills', 'personal'), { recursive: true });
    await mkdir(join(home, '.claude', 'commands'), { recursive: true });
    await mkdir(join(cwd, '.claude', 'skills', 'project-check'), { recursive: true });
    await mkdir(join(outside, 'private'), { recursive: true });

    await writeFile(
      join(home, '.claude', 'skills', 'personal', 'SKILL.md'),
      '---\nname: Personal\ndescription: "Useful helper"\n---\nSECRET BODY',
    );

    await writeFile(
      join(home, '.claude', 'commands', 'legacy.md'),
      '---\ndescription: Legacy personal command\n---\nSECRET BODY',
    );

    await writeFile(
      join(cwd, '.claude', 'skills', 'project-check', 'SKILL.md'),
      '---\nname: Check\ndescription: |\n  First line\n  second line\nuser-invocable: true\n---\nSECRET BODY',
    );

    await mkdir(join(cwd, '.claude', 'skills', 'hidden'), { recursive: true });

    await writeFile(
      join(cwd, '.claude', 'skills', 'hidden', 'SKILL.md'),
      '---\nname: Hidden\ndescription: hidden\nuser-invocable: false\n---\nSECRET BODY',
    );

    await mkdir(join(cwd, '.claude'), { recursive: true });

    await writeFile(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ skillOverrides: { Personal: 'off' } }),
    );

    await symlink(outside, join(cwd, '.claude', 'skills', 'escape'));

    const result = await discoverSessionSkills({
      cwd,
      home,
      configDirectory: join(home, '.claude'),
      args: [],
      assertCurrent: current,
    });

    expect(result.supported).toBe(true);
    expect(result.skills.map(({ invocation }) => invocation)).toEqual(['/Check', '/legacy']);
    expect(result.skills[0]?.description).toBe('First line second line');
    expect(result.skills[1]?.description).toBe('Legacy personal command');
    expect(JSON.stringify(result)).not.toContain('SECRET BODY');
    expect(JSON.stringify(result)).not.toContain(outside);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('limits output by UTF-8 bytes and marks omitted metadata as truncated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-size-'));
  const home = join(root, 'home');
  const cwd = join(root, 'project');

  try {
    await mkdir(join(home, '.claude'), { recursive: true });

    for (let index = 0; index < 200; index++) {
      const skill = join(cwd, '.claude', 'skills', `skill-${index}`);

      await mkdir(skill, { recursive: true });

      await writeFile(
        join(skill, 'SKILL.md'),
        `---\nname: skill-${index}\ndescription: ${'界'.repeat(900)}\n---\nBODY`,
      );
    }

    const result = await discoverSessionSkills({
      cwd,
      home,
      configDirectory: join(home, '.claude'),
      args: [],
      assertCurrent: async () => {},
    });

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(128 * 1024);
    expect(result.skills.every((skill) => Buffer.byteLength(skill.description, 'utf8') <= 1000)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps two Claude config profiles scoped to their captured HOME and CLAUDE_CONFIG_DIR', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-profiles-'));
  const cwd = join(root, 'project');
  const homes = [join(root, 'profile-a'), join(root, 'profile-b')];

  try {
    await mkdir(cwd, { recursive: true });

    for (const [index, home] of homes.entries()) {
      const name = `private-${index}`;
      const skill = join(home, '.claude', 'skills', name);

      await mkdir(skill, { recursive: true });

      await writeFile(
        join(skill, 'SKILL.md'),
        `---\nname: ${name}\ndescription: scoped ${name}\n---\nPRIVATE`,
      );
    }

    const results = await Promise.all(
      homes.map((home) =>
        discoverSessionSkills({
          cwd,
          home,
          configDirectory: join(home, '.claude'),
          args: [],
          assertCurrent: async () => {},
        }),
      ),
    );

    expect(results[0]?.skills.map(({ invocation }) => invocation)).toEqual(['/private-0']);
    expect(results[1]?.skills.map(({ invocation }) => invocation)).toEqual(['/private-1']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('lists metadata only for enabled installed plugins with namespaced invocations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-skills-plugin-'));
  const home = join(root, 'home');
  const config = join(home, '.claude');
  const cwd = join(root, 'project');
  const plugin = join(config, 'plugins', 'cache', 'market', 'reviewer', '1.0.0');
  const skill = join(plugin, 'skills', 'review');

  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(skill, { recursive: true });

    await writeFile(
      join(config, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'reviewer@market': true } }),
    );

    await mkdir(join(config, 'plugins'), { recursive: true });

    await writeFile(
      join(config, 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        plugins: { 'reviewer@market': [{ installPath: plugin }] },
      }),
    );

    await writeFile(
      join(skill, 'SKILL.md'),
      '---\nname: inspect\ndescription: Inspect a change\n---\nPRIVATE',
    );

    const result = await discoverSessionSkills({
      cwd,
      home,
      configDirectory: config,
      args: [],
      assertCurrent: async () => {},
    });

    expect(result.skills.map(({ invocation }) => invocation)).toEqual(['/reviewer:inspect']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
