import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  CheckpointSourceError,
  hasControlCharacter,
  NativeCheckpointSourceLimits,
  RepositoryFenceScope,
  sourceFailure,
} from './values.js';
import type { RepositoryIdentity, RepositoryWorkingTreeIdentity } from './types.js';

const execFileAsync = promisify(execFile);

const sensitivePath =
  /(?:^|\/)(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|[^/]*\.(?:key|pem|p12))$/iu;

async function git(cwd: string, args: string[]) {
  try {
    const result = await execFileAsync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
      encoding: 'utf8',
      timeout: NativeCheckpointSourceLimits.GitTimeoutMs,
      maxBuffer: NativeCheckpointSourceLimits.GitOutputBytes,
      env: {
        PATH: process.env.PATH,
        LC_ALL: 'C',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      },
    });

    if (Buffer.byteLength(result.stdout) > NativeCheckpointSourceLimits.GitOutputBytes) {
      throw sourceFailure(CheckpointSourceError.RepositoryBudgetExceeded);
    }

    return result.stdout;
  } catch (error) {
    if (error instanceof Error && error.message === CheckpointSourceError.RepositoryBudgetExceeded) {
      throw error;
    }

    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    ) {
      throw sourceFailure(CheckpointSourceError.RepositoryBudgetExceeded);
    }

    throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
  }
}

export async function probeRepository(cwd: string): Promise<RepositoryIdentity> {
  if (!isAbsolute(cwd) || hasControlCharacter(cwd)) {
    throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
  }

  const revision = (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).trim();

  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/iu.test(revision)) {
    throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
  }

  const listing = await git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const paths = listing.split('\0').filter(Boolean);

  if (paths.length > NativeCheckpointSourceLimits.GitFileEntries) {
    throw sourceFailure(CheckpointSourceError.RepositoryBudgetExceeded);
  }

  let root: string;

  try {
    root = await realpath(cwd);
  } catch {
    throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
  }

  const snapshot: string[] = [];

  for (const path of paths) {
    if (sensitivePath.test(path)) {
      throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
    }

    const absolute = resolve(root, path);
    const within = relative(root, absolute);

    if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) {
      throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
    }

    let info;
    let current = root;
    const parts = path.split('/');

    try {
      for (let index = 0; index < parts.length; index += 1) {
        current = join(current, parts[index]!);
        info = await lstat(current);

        if (index < parts.length - 1 && (!info.isDirectory() || info.isSymbolicLink())) {
          throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === CheckpointSourceError.RepositoryUnavailable) {
        throw error;
      }

      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        snapshot.push(`${path}\0missing`);
        continue;
      }

      throw sourceFailure(CheckpointSourceError.RepositoryUnavailable);
    }

    snapshot.push(
      `${path}\0${info!.dev}:${info!.ino}:${info!.mode}:${info!.size}:${info!.mtimeMs}:${info!.ctimeMs}:${info!.isSymbolicLink() ? 'link' : 'node'}`,
    );
  }

  const digest = createHash('sha256').update(root).update('\0').update(snapshot.join('\n')).digest('hex');

  const workingTree: RepositoryWorkingTreeIdentity = `${RepositoryFenceScope.GitVisibleMetadataV1}:${paths.length}:${digest}`;

  return { revision, workingTree };
}
