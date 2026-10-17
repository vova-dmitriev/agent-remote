import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdir, lstat, chmod, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function listening(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 300);

    const done = (alive: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(alive);
    };

    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function ensureManagedCodexSocket(stateDirectory: string, executable = 'codex') {
  const directory = join(stateDirectory, 'codex'),
    path = join(directory, 'app-server.sock'),
    lock = join(directory, 'launch.lock');

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);

  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error('CODEX_INVALID_SOCKET');
  }

  if (await listening(path)) {
    return path;
  }

  let handle;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      handle = await open(lock, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      if (await listening(path)) {
        return path;
      }

      await delay(100);
    }
  }

  if (!handle) {
    throw new Error('CODEX_DAEMON_START_FAILED');
  }

  try {
    if (await listening(path)) {
      return path;
    }

    try {
      const stale = await lstat(path);

      if (!stale.isSocket() || stale.uid !== process.getuid?.()) {
        throw new Error('CODEX_INVALID_SOCKET');
      }

      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const child = spawn(executable, ['app-server', '--listen', 'unix://' + path], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    });

    let failed = false;

    child.once('error', () => {
      failed = true;
    });

    child.once('exit', () => {
      failed = true;
    });

    child.unref();

    for (let attempt = 0; attempt < 100; attempt++) {
      if (failed) {
        throw new Error('CODEX_DAEMON_START_FAILED');
      }

      if (await listening(path)) {
        await chmod(path, 0o600);

        return path;
      }

      await delay(100);
    }

    child.kill('SIGTERM');
    throw new Error('CODEX_DAEMON_START_FAILED');
  } finally {
    await handle.close();
    await unlink(lock).catch(() => {});
  }
}
