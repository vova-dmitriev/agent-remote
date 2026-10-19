import { DaemonErrorCode } from '../error-codes.js';
import { shellQuote as quote } from '../shell/index.js';
import { ASCII_CONTROL_CHARACTERS } from '../validation/control-characters.js';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { CodedError } from '@protocol';

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

function assertShellPaths(paths: readonly string[]) {
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

export const claudeShellDirectory = () => process.env.CLAUDE_REMOTE_HOME ?? join(homedir(), '.claude-remote');

export async function installClaudeShell(
  options: ClaudeShellCommand & { directory: string; rcPath: string },
) {
  assertShellPaths([options.directory, options.rcPath, options.executable, options.node, options.entry]);

  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const fragment = join(options.directory, CLAUDE_SHELL_FRAGMENT);
  const source = claudeShellFragment(options);

  await writeFile(fragment, source, { mode: 0o600 });
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

  await writeFile(options.rcPath, previous + '\n# Agent Remote Claude terminal integration\n' + line + '\n', {
    mode: 0o600,
  });

  return { fragment, changed: true };
}

/**
 * Points an installed, unmodified fragment at the current session entry when its entry is gone or is
 * this install's pre-move `sessions/entry.js`. A missing fragment is never created.
 */
export async function refreshClaudeShellEntry(options: { directory: string; entry: string }) {
  assertShellPaths([options.directory, options.entry]);
  const fragment = join(options.directory, CLAUDE_SHELL_FRAGMENT);
  let source: string;

  try {
    if (!(await lstat(fragment)).isFile()) {
      return { fragment, changed: false };
    }

    source = await readFile(fragment, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { fragment, changed: false };
    }

    throw error;
  }

  const match = MANAGED_LAUNCH.exec(source);

  if (!match?.[1] || !match[2] || !match[3]) {
    return { fragment, changed: false };
  }

  const installed = { executable: unquote(match[1]), node: unquote(match[2]), entry: unquote(match[3]) };
  const legacyEntry = join(dirname(dirname(options.entry)), 'sessions', 'entry.js');

  if (
    installed.entry === options.entry ||
    source !== claudeShellFragment(installed) ||
    (installed.entry !== legacyEntry && existsSync(installed.entry))
  ) {
    return { fragment, changed: false };
  }

  assertShellPaths([installed.executable, installed.node]);
  await writeFile(fragment, claudeShellFragment({ ...installed, entry: options.entry }), { mode: 0o600 });

  return { fragment, changed: true };
}
