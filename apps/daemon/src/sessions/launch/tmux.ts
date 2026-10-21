import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TMUX } from './launcher.js';

type Execute = (file: string, args: string[]) => Promise<{ stdout: string }>;

/** The tmux pane a process runs in, from the environment tmux gives it; undefined outside tmux. */
export function tmuxPane(env: NodeJS.ProcessEnv): string | undefined {
  const pane = env.TMUX ? env.TMUX_PANE : undefined;

  return pane && /^%\d{1,9}$/u.test(pane) ? pane : undefined;
}

/** The visible screen of a tmux pane, as text. */
export async function readTmuxScreen(pane: string, execute: Execute = promisify(execFile)): Promise<string> {
  const { stdout } = await execute(TMUX, ['capture-pane', '-p', '-t', pane]);

  return stdout;
}
