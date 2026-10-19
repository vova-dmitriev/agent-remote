import type { ChildProcess } from 'node:child_process';
import { CodedError, ErrorCode } from '@protocol';
import { ProfileNativeLimits, ProfileProcessSignal } from '../values.js';

function waitForExit(child: ChildProcess, duration: number) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const done = (exited: boolean) => {
      clearTimeout(timer);
      child.off('exit', exit);
      resolve(exited);
    };

    const exit = () => done(true);
    const timer = setTimeout(() => done(false), duration);

    child.once('exit', exit);
  });
}

export function closeProfileProcess(child: ChildProcess) {
  let closing: Promise<void> | undefined;

  async function close() {
    child.stdin?.end();
    child.kill(ProfileProcessSignal.Terminate);

    if (await waitForExit(child, ProfileNativeLimits.CloseGraceMs)) {
      return;
    }

    child.kill(ProfileProcessSignal.Kill);

    if (!(await waitForExit(child, ProfileNativeLimits.CloseKillWaitMs))) {
      throw new CodedError(ErrorCode.REQUEST_TIMEOUT);
    }
  }

  return () => (closing ??= close());
}
