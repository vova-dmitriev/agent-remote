import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('rejects oversized files, crowded slice folders and hardcoded component colors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frontend-discipline-'));

  try {
    await mkdir(join(root, 'src/features/example/ui'), { recursive: true });
    await writeFile(join(root, 'src/features/example/ui/large.tsx'), 'export {};\n'.repeat(201));

    for (let i = 0; i < 6; i++) {
      await writeFile(join(root, 'src/features/example/ui', `part-${i}.ts`), 'export {};\n');
    }

    await writeFile(join(root, 'src/features/example/ui/color.css'), '.example {color:#ffffff}\n');

    await writeFile(
      join(root, 'src/features/example/ui/palette.tsx'),
      'export const Palette = () => <div className="bg-red-500 text-slate-900"/>;\n',
    );

    await writeFile(join(root, 'src/features/example/ui/rgb.css'), '.example {color:rgb(255,0,0)}\n');

    const result = spawnSync(
      process.execPath,
      [resolve('scripts/quality/check-frontend-structure.mjs'), root],
      {
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('200 lines');
    expect(result.stderr).toContain('6 files');
    expect(result.stderr).toContain('color.css');
    expect(result.stderr).toContain('palette.tsx');
    expect(result.stderr).toContain('rgb.css');
    expect(result.stderr).toContain('theme tokens');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('lint rejects assertion libraries and literal test ids in stories while allowing interaction stories', () => {
  const cwd = resolve('apps/mini-app');

  const lint = (source: string) => {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/eslint/bin/eslint.js',
        '--stdin',
        '--stdin-filename',
        'src/features/example/ui/example.stories.tsx',
        '--format',
        'json',
      ],
      { cwd, input: source, encoding: 'utf8', timeout: 15000 },
    );

    return (JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }> }>)[0]!.messages;
  };

  for (const source of [
    'import {expect} from "storybook/test"; export default {}; export const Bad={play:()=>expect(1).toBe(1)};',
    'import assert from "node:assert"; export default {}; export const Bad={play:()=>assert.strictEqual(1,1)};',
    'export default {}; export const Bad={render:()=> <div data-testid="literal"/>};',
  ]) {
    expect(lint(source).some((message) => message.ruleId === 'no-restricted-syntax')).toBe(true);
  }

  const valid = [
    'import type {Meta,StoryObj} from "@storybook/react-vite";',
    'import {Button} from "@/shared/ui/button";',
    '',
    'export default {component:Button} satisfies Meta<typeof Button>;',
    '',
    'export const Ready:StoryObj<typeof Button>={args:{children:"Continue"}};',
  ].join('\n');

  expect(lint(valid)).toEqual([]);
}, 30000);

it('lint rejects multiple arrow components in one production file', () => {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/eslint/bin/eslint.js',
      '--stdin',
      '--stdin-filename',
      'src/features/example/ui/example.tsx',
      '--format',
      'json',
    ],
    {
      cwd: resolve('apps/mini-app'),
      input: 'export const A = () => <div/>; export const B = () => <div/>;',
      encoding: 'utf8',
      timeout: 15000,
    },
  );

  const messages = (JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }> }>)[0]!
    .messages;

  expect(messages.some((message) => message.ruleId === 'frontend/one-component')).toBe(true);
});
