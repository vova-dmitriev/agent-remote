import { DaemonErrorCode } from '../error-codes.js';
import { ASCII_CONTROL_CHARACTERS } from '../validation/control-characters.js';
import { isAbsolute } from 'node:path';
import { CodedError } from '@protocol';

/** Local-only launcher flags. No server endpoint can select a process or its arguments. */
export function parseClaudeArgs(args: string[]): string[] {
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index],
      value = args[index + 1];

    if (!flag || !value || seen.has(flag)) {
      throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_ARGS);
    }

    seen.add(flag);

    if (flag === '--resume') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,511}$/.test(value)) {
        throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_ARGS);
      }
    } else if (flag === '--settings') {
      if (!isAbsolute(value) || value.length > 4096 || ASCII_CONTROL_CHARACTERS.test(value)) {
        throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_ARGS);
      }
    } else {
      throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_ARGS);
    }
  }

  return [...args];
}
