import { expect, it } from 'vitest';
import { restartArguments } from '../apps/daemon/src/sessions/launch/launch-context.js';

it('preserves launch configuration including explicit bypass but replaces conversation selectors without replaying the first prompt', () => {
  expect(
    restartArguments(
      [
        '--model',
        'opus',
        '--dangerously-skip-permissions',
        '--settings',
        '{"env":{"SYNTHETIC":"a b"}}',
        '--mcp-config',
        '/synthetic/a.json',
        '--session-id',
        'old',
        '--resume=older',
        '--continue',
        '--fork-session',
        'initial prompt',
      ],
      'original',
    ),
  ).toEqual([
    '--model',
    'opus',
    '--dangerously-skip-permissions',
    '--settings',
    '{"env":{"SYNTHETIC":"a b"}}',
    '--mcp-config',
    '/synthetic/a.json',
    '--resume',
    'original',
  ]);

  expect(restartArguments(['--permission-mode=plan', '--effort', 'high'], 'original')).toEqual([
    '--permission-mode=plan',
    '--effort',
    'high',
    '--resume',
    'original',
  ]);

  expect(restartArguments([], 'original')).toEqual(['--resume', 'original']);
});

it('does not guess unknown flags or accept a noninteractive launch', () => {
  expect(() => restartArguments(['--unknown-future-setting', 'value'], 'original')).toThrow(
    'LAUNCH_CONTEXT_UNAVAILABLE',
  );

  expect(() => restartArguments(['--print', 'text'], 'original')).toThrow('LAUNCH_CONTEXT_UNAVAILABLE');
});
