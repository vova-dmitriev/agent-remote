import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll } from 'vitest';

const run = promisify(execFile);
const TERMINATE_GRACE_MS = 3000;
const POLL_MS = 50;

/** Fixture roots and children of this test file; a runtime started from either must not outlive it. */
const roots = new Set<string>();
const children = new Set<ChildProcess>();

/** Registers a temporary fixture root; any process whose command line names it belongs to the test. */
export function trackRuntimeRoot(root: string) {
  roots.add(root);
}

/** Registers a child spawned by the test whose command line does not name a fixture root. */
export function trackRuntimeChild(child: ChildProcess) {
  children.add(child);
}

function running(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function processesUnder(paths: Iterable<string>) {
  const wanted = [...paths];

  if (!wanted.length || process.platform === 'win32') {
    return [];
  }

  const { stdout } = await run('ps', ['-axo', 'pid=,command='], { maxBuffer: 16 * 1024 * 1024 });

  return stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => !!match && Number(match[1]) !== process.pid)
    .filter((match) => wanted.some((path) => match[2]!.includes(path)))
    .map((match) => ({ pid: Number(match[1]), command: match[2]! }));
}

/**
 * Terminates every process started from `paths` (SIGTERM, then SIGKILL after a grace period) and
 * returns the command lines that were still running.
 */
export async function terminateRuntimeProcesses(
  paths: Iterable<string>,
  spawned: Iterable<ChildProcess> = [],
) {
  const found = await processesUnder(paths);

  for (const child of spawned) {
    if (child.pid && child.exitCode === null && child.signalCode === null && running(child.pid)) {
      found.push({ pid: child.pid, command: child.spawnargs.join(' ') });
    }
  }

  for (const { pid } of found) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }

  const deadline = Date.now() + TERMINATE_GRACE_MS;

  while (found.some(({ pid }) => running(pid)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  for (const { pid } of found) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }

  return found.map(({ pid, command }) => `${pid} ${command.slice(0, 200)}`);
}

/** Fails the calling test file when a tracked runtime survived its teardown, after killing it. */
export function guardRuntimeProcesses() {
  afterAll(async () => {
    const leaked = await terminateRuntimeProcesses(roots, children);

    roots.clear();
    children.clear();

    if (leaked.length) {
      throw new Error(`Runtime processes outlived the test file:\n${leaked.join('\n')}`);
    }
  }, TERMINATE_GRACE_MS + 10_000);
}

/** Points HOME, CODEX_HOME and CLAUDE_CONFIG_DIR of this process (and children inheriting it) into `root`. */
export async function isolateRuntimeHome(root: string) {
  const isolated = {
    HOME: join(root, 'home'),
    CODEX_HOME: join(root, 'codex-home'),
    CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
  };

  const previous = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));

  for (const [key, path] of Object.entries(isolated)) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    process.env[key] = path;
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
