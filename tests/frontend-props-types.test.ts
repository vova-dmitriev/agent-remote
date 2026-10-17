import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function lint(source: string) {
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
    { cwd: resolve('apps/mini-app'), input: source, encoding: 'utf8', timeout: 15000 },
  );

  return (JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }> }>)[0]!.messages;
}

it('rejects bulky inline component contracts, including memo and arrow components', () => {
  for (const source of [
    'export function Example({title,count}:{title:string;count:number}) {return <div>{title}{count}</div>}',
    'export const Example = ({title,count}:{title:string;count:number}) => <div>{title}{count}</div>',
    'import {memo} from "react";export const Example = memo(({title,count}:{title:string;count:number}) => <div>{title}{count}</div>)',
  ]) {
    expect(lint(source).some((message) => message.ruleId === 'frontend/named-props')).toBe(true);
  }
});

it('accepts named contracts and intrinsic React prop aliases', () => {
  for (const source of [
    'import type {ExampleProps} from "./example.types";export function Example({title,count}:ExampleProps) {return <div>{title}{count}</div>}',
    'import type {ComponentProps} from "react";export function Example(props:ComponentProps<"div">) {return <div {...props}/>} ',
  ]) {
    expect(lint(source).filter((message) => message.ruleId === 'frontend/named-props')).toEqual([]);
  }
});
