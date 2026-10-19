import { ErrorCode, ConnectorId, TargetKind, type Session } from '@protocol';
import { fileURLToPath } from 'node:url';
import { type NativeProcess } from './native-process.js';
import { type LaunchContext } from './launch-context.js';
import { prepareCmuxContext } from '../cmux/launch.js';
import { launchClaudeSession, validateProject } from './launcher.js';

export async function restartClaudeSession(
  session: Session,
  options: {
    directory: string;
    resolve: (sessionId: string, cwd?: string) => Promise<NativeProcess | undefined>;
    capture: (process: NativeProcess) => Promise<LaunchContext>;
    prepare?: typeof prepareCmuxContext;
    stop: (process: NativeProcess) => Promise<void>;
    launch?: typeof launchClaudeSession;
    stopped?: () => void;
    validate?: typeof validateProject;
    wait: (connectorId: string) => Promise<string>;
  },
) {
  if (
    session.target.kind !== TargetKind.ClaudeCodeCli ||
    session.target.connectorId !== ConnectorId.Native ||
    !session.claudeSessionId
  ) {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  const source = await options.resolve(session.claudeSessionId, session.cwd);

  if (!source) {
    throw new Error(ErrorCode.STALE_SESSION);
  }

  const cwd = await (options.validate ?? validateProject)(source.cwd);
  const launchContext = await options.capture(source);
  const cmux = await (options.prepare ?? prepareCmuxContext)(launchContext.env);

  if (cmux) {
    launchContext.env.CMUX_WINDOW_ID = cmux.windowId;
  }

  await options.stop(source);
  options.stopped?.();

  const connectorId = await (options.launch ?? launchClaudeSession)({
    directory: options.directory,
    cwd,
    node: process.execPath,
    entry: fileURLToPath(new URL('./entry.js', import.meta.url)),
    resumeId: session.claudeSessionId,
    launchContext,
    ...(cmux ? { cmux } : {}),
  });

  return options.wait(connectorId);
}
