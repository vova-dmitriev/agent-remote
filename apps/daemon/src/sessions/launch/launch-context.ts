import { DaemonErrorCode } from '../../error-codes.js';
import { ErrorCode } from '@protocol';

import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { ClaudeRestartArgument } from '../../domain/claude.js';

export const launchContextSchema = z.object({
  executable: z.string().refine(isAbsolute),
  args: z
    .array(
      z
        .string()
        .max(131072)
        .refine((value) => !value.includes('\0')),
    )
    .max(4096),
  env: z.record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    z
      .string()
      .max(262144)
      .refine((value) => !value.includes('\0')),
  ),
});
export type LaunchContext = z.infer<typeof launchContextSchema>;

const single = new Set([
  '--agent',
  '--agents',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--autocompact',
  '--debug-file',
  '--effort',
  '--fallback-model',
  '--json-schema',
  '--max-budget-usd',
  '--model',
  '-n',
  '--name',
  '--permission-mode',
  '--plugin-dir',
  '--plugin-url',
  '--remote-control-session-name-prefix',
  '--setting-sources',
  '--settings',
  '--system-prompt',
  '--system-prompt-file',
  '--system-prompt-snapshot',
]);

const multiple = new Set([
  '--add-dir',
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--betas',
  '--mcp-config',
  '--tools',
]);

const optional = new Set(['-d', '--debug', '--prompt-suggestions', '--remote-control']);

const boolean = new Set([
  '--allow-dangerously-skip-permissions',
  '--dangerously-skip-permissions',
  '--ax-screen-reader',
  '--brief',
  '--chrome',
  '--no-chrome',
  '--disable-slash-commands',
  '--exclude-dynamic-system-prompt-sections',
  '--ide',
  '--restricted',
  '--strict-mcp-config',
  '--verbose',
]);

export function restartArguments(args: readonly string[], sessionId: string): string[] {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,511}$/.test(sessionId)) {
    throw new Error(DaemonErrorCode.INVALID_CLAUDE_ARGS);
  }

  const result: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!,
      flag = argument.split('=')[0]!,
      inline = argument.includes('=');

    if (Object.values(ClaudeRestartArgument).some((value) => value === flag)) {
      continue;
    }

    if (['--resume', '-r', '--from-pr', '--session-id', '--worktree', '-w', '--teleport'].includes(flag)) {
      if (!inline && args[index + 1] !== undefined && !args[index + 1]!.startsWith('-')) {
        index++;
      }

      continue;
    }

    if (argument === '--') {
      break;
    }

    if (!argument.startsWith('-')) {
      continue;
    }

    if (!single.has(flag) && !multiple.has(flag) && !optional.has(flag) && !boolean.has(flag)) {
      throw new Error(ErrorCode.LAUNCH_CONTEXT_UNAVAILABLE);
    }

    result.push(argument);

    if (inline || boolean.has(flag)) {
      continue;
    }

    if (single.has(flag)) {
      const value = args[++index];

      if (value === undefined) {
        throw new Error(ErrorCode.LAUNCH_CONTEXT_UNAVAILABLE);
      }

      result.push(value);
    } else if (multiple.has(flag)) {
      let count = 0;

      while (args[index + 1] !== undefined && !args[index + 1]!.startsWith('-')) {
        result.push(args[++index]!);
        count++;
      }

      if (!count) {
        throw new Error(ErrorCode.LAUNCH_CONTEXT_UNAVAILABLE);
      }
    } else if (args[index + 1] !== undefined && !args[index + 1]!.startsWith('-')) {
      result.push(args[++index]!);
    }
  }

  return [...result, '--resume', sessionId];
}
