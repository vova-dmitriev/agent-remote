import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function lint(source: string, fix = false) {
  const args = [
    'node_modules/eslint/bin/eslint.js',
    '--stdin',
    '--stdin-filename',
    'src/features/example/model/use-example.ts',
    '--format',
    'json',
  ];

  if (fix) {
    args.push('--fix-dry-run');
  }

  const result = spawnSync(process.execPath, args, {
    cwd: resolve('apps/mini-app'),
    input: source,
    encoding: 'utf8',
    timeout: 15000,
  });

  return (
    JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }>; output?: string }>
  )[0]!;
}

it('requires blank lines between logical blocks and automatically fixes them', () => {
  const source = [
    'import { useEffect } from "react";',
    'export function useExample() {',
    '  const first = 1;',
    '  const second = 2;',
    '  useEffect(() => {',
    '    console.log(first);',
    '  }, []);',
    '  function reset() {',
    '    console.log(second);',
    '  }',
    '  return { first, second, reset };',
    '}',
  ].join('\n');

  expect(lint(source).messages.some((message) => message.ruleId === 'padding-line-between-statements')).toBe(
    true,
  );

  const fixed = lint(source, true);

  expect(fixed.messages.filter((message) => message.ruleId === 'padding-line-between-statements')).toEqual(
    [],
  );

  expect(fixed.output).toContain('from "react";\n\nexport');
  expect(fixed.output).toContain('const first = 1;\n  const second = 2;\n\n  useEffect');
  expect(fixed.output).toContain('}, []);\n\n  function reset');
  expect(fixed.output).toContain('  }\n\n  return');
});
