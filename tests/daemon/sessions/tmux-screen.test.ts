import { expect, it, vi } from 'vitest';
import { tmuxPane, readTmuxScreen } from '@daemon/sessions/launch/tmux.js';

it('takes the pane tmux names in the environment, and nothing that is not a pane id', () => {
  expect(tmuxPane({ TMUX: '/tmp/tmux-1000/default,1,0', TMUX_PANE: '%12' })).toBe('%12');
  expect(tmuxPane({ TMUX_PANE: '%12' })).toBeUndefined();
  expect(tmuxPane({ TMUX: '/tmp/tmux', TMUX_PANE: '-t evil' })).toBeUndefined();
  expect(tmuxPane({})).toBeUndefined();
});

it("reads the pane's visible screen as text", async () => {
  const execute = vi.fn(async () => ({ stdout: 'Switch model?\n❯ 1. Yes, switch to Sonnet\n' }));

  expect(await readTmuxScreen('%12', execute)).toBe('Switch model?\n❯ 1. Yes, switch to Sonnet\n');
  expect(execute).toHaveBeenCalledWith('tmux', ['capture-pane', '-p', '-t', '%12']);
});
