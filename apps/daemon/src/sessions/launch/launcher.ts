import { DaemonErrorCode } from '../../error-codes.js';
import { CodedError, ErrorCode } from '@protocol';

import { shellQuote as quote } from '../../shell/index.js';
import { ASCII_CONTROL_CHARACTERS } from '../../validation/control-characters.js';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, stat, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { type LaunchContext } from './launch-context.js';
import { type CmuxContext } from '../../cmux/context.js';
import { launchInCmux } from '../../cmux/launch.js';
import { logDebug } from '../../diagnostics/log.js';

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

export async function launchClaudeSession(options: {
  directory: string;
  cwd: string;
  node: string;
  entry: string;
  resumeId?: string;
  launchContext?: LaunchContext;
  cmux?: CmuxContext;
  launchCmux?: typeof launchInCmux;
  open?: (file: string, args: string[]) => Promise<unknown>;
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

  await writeFile(
    script,
    '#!/bin/sh\ncd -- ' +
      quote(options.cwd) +
      ' || exit 1\n/bin/rm -- "$0"\nexport CLAUDE_REMOTE_LAUNCH_ID=' +
      id +
      '\nexport CLAUDE_REMOTE_HOME=' +
      quote(options.directory) +
      '\nexec ' +
      quote(options.node) +
      ' ' +
      quote(options.entry) +
      (options.launchContext
        ? ' restore-claude ' + quote(payload)
        : ' claude' + (options.resumeId ? ' --resume ' + quote(options.resumeId) : '')) +
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
    } else {
      await (options.open ?? ((file, args) => execute(file, args)))('/usr/bin/open', [
        '-a',
        'Terminal',
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
