import { DaemonErrorCode } from '../../error-codes.js';
import { CodedError, ErrorCode, type ModelChoice } from '@protocol';

import { shellQuote as quote } from '../../shell/index.js';
import { ASCII_CONTROL_CHARACTERS } from '../../validation/control-characters.js';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, realpath, stat, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { type LaunchContext } from './launch-context.js';
import { type CmuxContext } from '../../cmux/context.js';
import { CMUX_APP_CLI, launchInCmux } from '../../cmux/launch.js';
import { logDebug } from '../../diagnostics/log.js';
import { projectWorkspace, type CmuxRun } from '../../cmux/workspaces.js';

const execute = promisify(execFile);

export async function validateProject(cwd: string): Promise<string> {
  try {
    if (!isAbsolute(cwd) || ASCII_CONTROL_CHARACTERS.test(cwd)) {
      throw new Error();
    }

    const path = await realpath(cwd);

    if (!(await stat(path)).isDirectory()) {
      throw new Error();
    }

    return path;
  } catch {
    throw new CodedError(ErrorCode.INVALID_PROJECT);
  }
}

/** The terminal multiplexer that hosts Claude sessions where there is no Terminal app. */
export const TMUX = 'tmux';
/** tmux session names of Claude sessions this daemon started, followed by the launch id. */
const TMUX_SESSION_PREFIX = 'agent-remote-';

/** cmux's command line where cmux is installed (`CMUX_CLI` names another). */
async function installedCmux() {
  const cli = process.env.CMUX_CLI ?? CMUX_APP_CLI;

  return (await access(cli, constants.X_OK).then(
    () => true,
    () => false,
  ))
    ? cli
    : null;
}

export async function launchClaudeSession(options: {
  directory: string;
  cwd: string;
  node: string;
  entry: string;
  resumeId?: string;
  /** The model and effort the owner picked for a new session. */
  model?: ModelChoice;
  launchContext?: LaunchContext;
  cmux?: CmuxContext;
  launchCmux?: typeof launchInCmux;
  open?: CmuxRun;
  /** Where the session runs: Terminal on macOS, a detached tmux session elsewhere (a Linux VM). */
  platform?: NodeJS.Platform;
  /** cmux's command line; on macOS a new session opens in a new cmux workspace when it is there. Null: Terminal. */
  cmuxCli?: string | null;
  /** Opens Codex on this thread of the daemon's own app-server instead of Claude. */
  codexThreadId?: string;
  /** Codex's home, where it records threads (`CODEX_HOME`, else ~/.codex). */
  codexHome?: string;
}): Promise<string> {
  if (options.resumeId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,511}$/.test(options.resumeId)) {
    throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_ARGS);
  }

  const id = randomUUID(),
    directory = join(options.directory, 'launchers');

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const script = join(directory, id + '.command');
  const payload = join(directory, id + '.json');

  if (options.launchContext) {
    await writeFile(payload, JSON.stringify(options.launchContext), { mode: 0o600, flag: 'wx' });
  }

  const claude = options.launchContext
    ? ' restore-claude ' + quote(payload)
    : ' claude' +
      (options.resumeId ? ' --resume ' + quote(options.resumeId) : '') +
      (options.model ? ' --model ' + quote(options.model.model) : '') +
      (options.model?.effort ? ' --effort ' + quote(options.model.effort) : '');

  const agent = options.codexThreadId ? ' codex resume ' + quote(options.codexThreadId) : claude;

  // Codex records a new thread only with its first message, and resumes only a recorded one.
  const recorded = options.codexThreadId
    ? 'until ls ' +
      quote(join(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')) +
      '/*/*/*/rollout-*-' +
      quote(options.codexThreadId) +
      '.jsonl >/dev/null 2>&1; do [ "$waiting" ] || echo \'Codex opens here after the first message.\'; waiting=1; sleep 1; done\n'
    : '';

  await writeFile(
    script,
    '#!/bin/sh\ncd -- ' +
      quote(options.cwd) +
      ' || exit 1\n/bin/rm -- "$0"\n' +
      // A Terminal the daemon opened inherits its environment: a daemon started inside Claude Code would make this
      // Claude a child of that session, which keeps no transcript of its own to continue.
      'unset CLAUDE_PID; for name in $(env | sed -n "s/^\\(CLAUDE_CODE_[A-Za-z0-9_]*\\)=.*/\\1/p"); do unset "$name"; done\n' +
      'export CLAUDE_REMOTE_LAUNCH_ID=' +
      id +
      '\nexport CLAUDE_REMOTE_HOME=' +
      quote(options.directory) +
      '\n' +
      recorded +
      'exec ' +
      quote(options.node) +
      ' ' +
      quote(options.entry) +
      agent +
      '\n',
    { mode: 0o700, flag: 'wx' },
  );

  try {
    if (options.cmux) {
      await (options.launchCmux ?? launchInCmux)(
        script,
        options.cmux,
        options.launchContext?.env ?? process.env,
      );
    } else if ((options.platform ?? process.platform) === 'darwin') {
      const run = options.open ?? ((file: string, args: string[]) => execute(file, args));
      const cmux = options.cmuxCli === undefined ? await installedCmux() : options.cmuxCli;
      const command = ['--command', '/bin/sh ' + quote(script), '--focus', 'false'];

      if (!cmux) {
        await run('/usr/bin/open', ['-a', 'Terminal', script]);
      } else {
        // A new tab next to the project's open workspace, else a workspace of its own.
        const workspace = await projectWorkspace(run, cmux, options.cwd).catch((error: unknown) => {
          logDebug('sessions/launch/launcher', error);

          return null;
        });

        await run(
          cmux,
          workspace
            ? [
                'new-surface',
                '--window',
                workspace.windowId,
                '--workspace',
                workspace.workspaceId,
                ...command,
              ]
            : ['new-workspace', '--cwd', options.cwd, ...command],
        );
      }
    } else {
      // No Terminal app on a Linux VM: tmux gives the wrapper a terminal that outlives the daemon and whose screen
      // the wrapper can read.
      await (options.open ?? ((file, args) => execute(file, args)))(TMUX, [
        'new-session',
        '-d',
        '-s',
        TMUX_SESSION_PREFIX + id,
        '/bin/sh',
        script,
      ]);
    }
  } catch {
    await rm(payload, { force: true }).catch((error: unknown) => logDebug('sessions/launch/launcher', error));
    await rm(script, { force: true }).catch((error: unknown) => logDebug('sessions/launch/launcher', error));
    throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
  }

  return id;
}
