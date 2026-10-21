import { CodedError, ErrorCode, TargetKind } from '@protocol';
import type { Session, SessionSkills } from '@protocol';
import type { MonitorPort } from '../domain/ports/monitor.js';
import type { NativeProcess, NativeSkillsProcessPort } from '../domain/ports/native/process.js';
import { discoverSessionSkills } from './catalog.js';
import { SKILL_FILE_NAMES } from './values.js';

interface SessionIdentity {
  id: string;
  generation: string;
  cwd: string;
  claudeSessionId: string;
  target: Session['target'];
}

function sameSession(current: Session | undefined, expected: SessionIdentity): boolean {
  return Boolean(
    current &&
    current.id === expected.id &&
    current.generation === expected.generation &&
    current.cwd === expected.cwd &&
    current.claudeSessionId === expected.claudeSessionId &&
    JSON.stringify(current.target) === JSON.stringify(expected.target),
  );
}

function unsupported(sessionId: string, generation: string): SessionSkills {
  return { sessionId, generation, supported: false, truncated: false, skills: [] };
}

export class SessionSkillsService {
  constructor(
    private readonly monitor: Pick<MonitorPort, 'session'>,
    private readonly nativeProcesses: NativeSkillsProcessPort,
  ) {}

  async list(sessionId: string, generation: string): Promise<SessionSkills> {
    const session = this.monitor.session(sessionId);

    if (!session || session.generation !== generation) {
      throw new CodedError(ErrorCode.STALE_SESSION);
    }

    if (
      !session.cwd ||
      !session.claudeSessionId ||
      (session.target.kind !== TargetKind.ClaudeCodeCli && session.target.kind !== TargetKind.Cmux)
    ) {
      return unsupported(sessionId, generation);
    }

    const identity: SessionIdentity = {
      id: session.id,
      generation: session.generation,
      cwd: session.cwd,
      claudeSessionId: session.claudeSessionId,
      target: structuredClone(session.target),
    };

    const validateSession = () => {
      if (!sameSession(this.monitor.session(sessionId), identity)) {
        throw new CodedError(ErrorCode.STALE_SESSION);
      }
    };

    const process = await this.nativeProcesses.resolve(identity.claudeSessionId, identity.cwd);

    validateSession();

    if (!process) {
      return unsupported(sessionId, generation);
    }

    if (identity.target.kind === TargetKind.Cmux && !(await this.cmuxBound(identity.target, process.pid))) {
      validateSession();

      return unsupported(sessionId, generation);
    }

    validateSession();
    const context = await this.nativeProcesses.capture(process);

    const assertSessionCurrent = async () => {
      validateSession();
    };

    const assertCurrent = async () => {
      validateSession();
      const current = await this.nativeProcesses.resolve(identity.claudeSessionId, identity.cwd);

      const cmuxBound =
        identity.target.kind !== TargetKind.Cmux || (await this.cmuxBound(identity.target, process.pid));

      if (
        !sameProcess(current, process) ||
        !cmuxBound ||
        !sameSession(this.monitor.session(sessionId), identity)
      ) {
        throw new CodedError(ErrorCode.STALE_SESSION);
      }
    };

    await assertCurrent();

    const home = context.env.HOME;

    const configDirectory =
      context.env.CLAUDE_CONFIG_DIR ??
      (home ? `${home.replace(/\/$/u, '')}/${SKILL_FILE_NAMES.claudeDirectory}` : undefined);

    if (!home || !configDirectory || !home.startsWith('/') || !configDirectory.startsWith('/')) {
      return unsupported(sessionId, generation);
    }

    const result = await discoverSessionSkills({
      cwd: session.cwd,
      home,
      configDirectory,
      args: context.args,
      assertCurrent: assertSessionCurrent,
    });

    await assertCurrent();

    return { ...result, sessionId, generation };
  }

  private async cmuxBound(target: Session['target'], pid: number): Promise<boolean> {
    if (target.kind !== TargetKind.Cmux) {
      return true;
    }

    const surface = await this.nativeProcesses.cmuxSurface(pid);

    return Boolean(
      surface &&
      surface.workspaceId.toLowerCase() === target.workspaceId.toLowerCase() &&
      surface.surfaceId.toLowerCase() === target.surfaceId.toLowerCase(),
    );
  }
}

function sameProcess(current: NativeProcess | undefined, expected: NativeProcess): boolean {
  return Boolean(
    current &&
    current.pid === expected.pid &&
    current.procStart === expected.procStart &&
    current.sessionId === expected.sessionId &&
    current.cwd === expected.cwd,
  );
}
