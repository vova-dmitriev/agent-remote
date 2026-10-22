import { DaemonErrorCode } from '../error-codes.js';
import { shellQuote as quote } from '../shell/index.js';
import { ASCII_CONTROL_CHARACTERS } from '../validation/control-characters.js';
import { missing, safeEntry, secureDirectory } from '../local/supervisor/runtime.js';
import { constants, type Stats } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { CodedError, ErrorCode } from '@protocol';

const CLAUDE_SHELL_FRAGMENT = 'claude.zsh';
const QUOTED = String.raw`'(?:[^']|'\\'')*'`;

const MANAGED_LAUNCH = new RegExp(
  String.raw`CLAUDE_REMOTE_NATIVE_CLAUDE=(${QUOTED}) (${QUOTED}) (${QUOTED}) terminal-claude "\$@"`,
);

interface ClaudeShellCommand {
  executable: string;
  node: string;
  entry: string;
}

export function assertShellPaths(paths: readonly string[]) {
  for (const path of paths) {
    if (!isAbsolute(path) || ASCII_CONTROL_CHARACTERS.test(path)) {
      throw new CodedError(DaemonErrorCode.INVALID_SHELL_PATH);
    }
  }
}

function claudeShellFragment(options: ClaudeShellCommand) {
  return `# Agent Remote: interactive Claude owns a PTY; scripts use the native binary.\nclaude() {\n  local agent_remote_arg\n  if [[ ! -t 0 || ! -t 1 || -n "$CLAUDE_REMOTE_WRAPPER_ID" ]]; then\n    command ${quote(options.executable)} "$@"\n    return $?\n  fi\n  case "\${1-}" in\n    agents|attach|auth|auto-mode|chrome|completion|config|doctor|desktop|install|logs|mcp|plugin|plugins|purge|respawn|rm|setup-token|stop|kill|ultrareview|update|upgrade|remote-control|rc)\n      command ${quote(options.executable)} "$@"; return $? ;;\n  esac\n  for agent_remote_arg in "$@"; do\n    case "$agent_remote_arg" in\n      -p|--print|--print=*|--input-format|--input-format=*|--output-format|--output-format=*|-h|--help|-v|--version|--bg|--background)\n        command ${quote(options.executable)} "$@"; return $? ;;\n    esac\n  done\n  CLAUDE_REMOTE_NATIVE_CLAUDE=${quote(options.executable)} ${quote(options.node)} ${quote(options.entry)} terminal-claude "$@"\n}\n`;
}

const unquote = (value: string) => value.slice(1, -1).replaceAll("'\\''", "'");

const untrusted = () => new CodedError(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
const sameFile = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino;

/**
 * Publishes `content` by renaming a synced sibling over `path`, so a reader sees the old or the new
 * file and never a partial one. With `expected`, `path` must still be that regular file at publish time.
 */
async function replaceFileAtomically(path: string, content: string, mode: number, expected?: Stats) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);

  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );

    try {
      await handle.writeFile(content);
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (expected) {
      const current = await lstat(path);

      if (!current.isFile() || !sameFile(current, expected)) {
        throw untrusted();
      }
    }

    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readRegularFile(path: string, expected: Stats) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    if (!sameFile(await handle.stat(), expected)) {
      throw untrusted();
    }

    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

const pathExists = (path: string) =>
  stat(path).then(
    () => true,
    (error: unknown) => !missing(error),
  );

export const claudeShellDirectory = () => process.env.CLAUDE_REMOTE_HOME ?? join(homedir(), '.claude-remote');

/** Writes a shell fragment into `directory` and sources it from the rc file once, keeping a backup of the rc file. */
export async function installShellFragment(options: {
  directory: string;
  rcPath: string;
  name: string;
  source: string;
  comment: string;
}) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const fragment = join(options.directory, options.name);

  await replaceFileAtomically(fragment, options.source, 0o600);
  let previous = '';

  try {
    previous = await readFile(options.rcPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const line = 'source ' + quote(fragment);

  if (previous.split('\n').includes(line)) {
    return { fragment, changed: false };
  }

  await mkdir(dirname(options.rcPath), { recursive: true, mode: 0o700 });

  if (previous) {
    await copyFile(options.rcPath, options.rcPath + '.agent-remote-' + Date.now() + '.bak');
  }

  await writeFile(options.rcPath, previous + `\n# ${options.comment}\n` + line + '\n', { mode: 0o600 });

  return { fragment, changed: true };
}

export async function installClaudeShell(
  options: ClaudeShellCommand & { directory: string; rcPath: string },
) {
  assertShellPaths([options.directory, options.rcPath, options.executable, options.node, options.entry]);

  return installShellFragment({
    directory: options.directory,
    rcPath: options.rcPath,
    name: CLAUDE_SHELL_FRAGMENT,
    source: claudeShellFragment(options),
    comment: 'Agent Remote Claude terminal integration',
  });
}

/**
 * Points an installed, unmodified fragment at the current session entry when its entry is gone or is
 * this install's pre-move `sessions/entry.js`. A missing fragment is never created.
 */
export async function refreshClaudeShellEntry(options: { directory: string; entry: string }) {
  if (options.directory !== claudeShellDirectory()) {
    throw new CodedError(DaemonErrorCode.INVALID_SHELL_PATH);
  }

  assertShellPaths([options.directory, options.entry]);
  const fragment = join(options.directory, CLAUDE_SHELL_FRAGMENT);

  if (!(await pathExists(options.directory))) {
    return { fragment, changed: false };
  }

  await secureDirectory(options.directory);
  let identity: Stats;

  try {
    identity = await lstat(fragment);
  } catch (error) {
    if (missing(error)) {
      return { fragment, changed: false };
    }

    throw error;
  }

  if (!identity.isFile()) {
    return { fragment, changed: false };
  }

  safeEntry(identity);
  const source = await readRegularFile(fragment, identity);
  const match = MANAGED_LAUNCH.exec(source);

  if (!match?.[1] || !match[2] || !match[3]) {
    return { fragment, changed: false };
  }

  const installed = { executable: unquote(match[1]), node: unquote(match[2]), entry: unquote(match[3]) };
  const legacyEntry = join(dirname(dirname(options.entry)), 'sessions', 'entry.js');

  if (
    installed.entry === options.entry ||
    source !== claudeShellFragment(installed) ||
    (installed.entry !== legacyEntry && (await pathExists(installed.entry)))
  ) {
    return { fragment, changed: false };
  }

  assertShellPaths([installed.executable, installed.node]);

  await replaceFileAtomically(
    fragment,
    claudeShellFragment({ ...installed, entry: options.entry }),
    identity.mode & 0o7777,
    identity,
  );

  return { fragment, changed: true };
}
