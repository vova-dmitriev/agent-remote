import { DaemonErrorCode } from '../error-codes.js';
import { shellQuote as quote } from '../shell/index.js';
import { ASCII_CONTROL_CHARACTERS } from '../validation/control-characters.js';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { CodedError } from '@protocol';

export async function installClaudeShell(options: {
  directory: string;
  rcPath: string;
  executable: string;
  node: string;
  entry: string;
}) {
  for (const path of [options.directory, options.rcPath, options.executable, options.node, options.entry]) {
    if (!isAbsolute(path) || ASCII_CONTROL_CHARACTERS.test(path)) {
      throw new CodedError(DaemonErrorCode.INVALID_SHELL_PATH);
    }
  }

  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const fragment = join(options.directory, 'claude.zsh');
  const source = `# Agent Remote: interactive Claude owns a PTY; scripts use the native binary.\nclaude() {\n  local agent_remote_arg\n  if [[ ! -t 0 || ! -t 1 || -n "$CLAUDE_REMOTE_WRAPPER_ID" ]]; then\n    command ${quote(options.executable)} "$@"\n    return $?\n  fi\n  case "\${1-}" in\n    agents|attach|auth|auto-mode|chrome|completion|config|doctor|desktop|install|logs|mcp|plugin|plugins|purge|respawn|rm|setup-token|stop|kill|ultrareview|update|upgrade|remote-control|rc)\n      command ${quote(options.executable)} "$@"; return $? ;;\n  esac\n  for agent_remote_arg in "$@"; do\n    case "$agent_remote_arg" in\n      -p|--print|--print=*|--input-format|--input-format=*|--output-format|--output-format=*|-h|--help|-v|--version|--bg|--background)\n        command ${quote(options.executable)} "$@"; return $? ;;\n    esac\n  done\n  CLAUDE_REMOTE_NATIVE_CLAUDE=${quote(options.executable)} ${quote(options.node)} ${quote(options.entry)} terminal-claude "$@"\n}\n`;

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
