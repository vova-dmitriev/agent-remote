import type { ChildProcess } from 'node:child_process';
import { ManagedCodexLaunchEvidenceType, type ManagedCodexLaunchEvidence } from './types.js';

const ownedChildren = new Map<string, ChildProcess>();
const exitObservers = new WeakMap<ChildProcess, Set<() => void>>();

function observeExit(child: ChildProcess, observer: () => void) {
  const observers = exitObservers.get(child) ?? new Set<() => void>();

  observers.add(observer);
  exitObservers.set(child, observers);
}

export function ownedProfileChild(path: string, report?: (evidence: ManagedCodexLaunchEvidence) => void) {
  const child = ownedChildren.get(path);

  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return undefined;
  }

  if (report) {
    observeExit(child, () => report({ type: ManagedCodexLaunchEvidenceType.ChildExited, pid: child.pid! }));
  }

  return child;
}

export function trackOwnedProfileChild(path: string, child: ChildProcess, onExit: () => void) {
  if (!child.pid) {
    return;
  }

  ownedChildren.set(path, child);
  observeExit(child, onExit);

  child.once('exit', () => {
    if (ownedChildren.get(path) === child) {
      ownedChildren.delete(path);
    }

    const observers = exitObservers.get(child);

    exitObservers.delete(child);

    for (const observer of observers ?? []) {
      observer();
    }
  });
}

export function forgetOwnedProfileChild(path: string, child: ChildProcess) {
  if (ownedChildren.get(path) === child) {
    ownedChildren.delete(path);
  }
}
