import { shellQuote as quote } from '../shell/index.js';
import { assertShellPaths, installShellFragment } from './shell-integration.js';

const CODEX_SHELL_FRAGMENT = 'codex.zsh';

/** Set by the shell function: a Codex started from the terminal runs without Agent Remote when the daemon is down. */
export const CODEX_SHELL_FALLBACK = 'AGENT_REMOTE_CODEX_FALLBACK';

/** Codex's commands that are not an interactive session: they run as installed. */
const PASSTHROUGH_COMMANDS =
  'agents|exec|e|review|login|logout|mcp|mcp-server|plugin|app-server|remote-control|app|completion|update|doctor|sandbox|debug|apply|a|queue|archive|delete|migrate-rollouts|unarchive|cloud|exec-server|features|help';

interface CodexShellCommand {
  /** Node, and Agent Remote's `remote` command it runs. */
  node: string;
  remote: string;
}

export function codexShellFragment(options: CodexShellCommand) {
  return `# Agent Remote: interactive Codex runs on Agent Remote's app-server, so the app follows it; scripts and other commands run Codex as installed.
codex() {
  local agent_remote_arg
  if [[ ! -t 0 || ! -t 1 ]]; then
    command codex "$@"
    return $?
  fi
  case "\${1-}" in
    ${PASSTHROUGH_COMMANDS})
      command codex "$@"; return $? ;;
  esac
  for agent_remote_arg in "$@"; do
    case "$agent_remote_arg" in
      -h|--help|-V|--version|--remote|--remote=*)
        command codex "$@"; return $? ;;
    esac
  done
  ${CODEX_SHELL_FALLBACK}=1 ${quote(options.node)} ${quote(options.remote)} codex "$@"
}
`;
}

export async function installCodexShell(options: CodexShellCommand & { directory: string; rcPath: string }) {
  assertShellPaths([options.directory, options.rcPath, options.node, options.remote]);

  return installShellFragment({
    directory: options.directory,
    rcPath: options.rcPath,
    name: CODEX_SHELL_FRAGMENT,
    source: codexShellFragment(options),
    comment: 'Agent Remote Codex terminal integration',
  });
}
