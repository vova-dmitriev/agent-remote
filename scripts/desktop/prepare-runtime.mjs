import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertPinnedDesktopNode, desktopNodeTarget } from './runtime-pin.mjs';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const toolchains = join(repository, 'output', 'toolchains');

export async function verifyPreparedRuntime(
  directory,
  platform,
  architecture,
  target = desktopNodeTarget(platform, architecture),
) {
  const nodePath = join(directory, 'bin', 'node');
  const archivePath = join(directory, 'node-archive.tar.gz');
  const directoryInfo = await lstat(directory);

  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    directoryInfo.mode & 0o022 ||
    (process.getuid && directoryInfo.uid !== process.getuid() && directoryInfo.uid !== 0) ||
    (await realpath(directory)) !== directory
  ) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  const nodeInfo = await lstat(nodePath);
  const archiveInfo = await lstat(archivePath);

  if (
    !nodeInfo.isFile() ||
    nodeInfo.isSymbolicLink() ||
    nodeInfo.nlink !== 1 ||
    nodeInfo.mode & 0o022 ||
    (process.getuid && nodeInfo.uid !== process.getuid() && nodeInfo.uid !== 0) ||
    !archiveInfo.isFile() ||
    archiveInfo.isSymbolicLink() ||
    archiveInfo.nlink !== 1 ||
    archiveInfo.mode & 0o022 ||
    (process.getuid && archiveInfo.uid !== process.getuid() && archiveInfo.uid !== 0)
  ) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  const archiveFile = await open(archivePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let archive;

  try {
    const opened = await archiveFile.stat();

    if (opened.ino !== archiveInfo.ino || opened.dev !== archiveInfo.dev) {
      throw new Error('LOCAL_RUNTIME_UNTRUSTED');
    }

    archive = await archiveFile.readFile();
  } finally {
    await archiveFile.close();
  }

  if (createHash('sha256').update(archive).digest('hex') !== target.archiveSha256) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  const verificationRoot = await mkdtemp(join(dirname(directory), '.node-verify-'));
  let archivedNode;

  try {
    const verifiedArchivePath = join(verificationRoot, target.archiveName);
    const archiveMember = `${target.archiveName.slice(0, -'.tar.gz'.length)}/bin/node`;

    await writeFile(verifiedArchivePath, archive, { mode: 0o600, flag: 'wx' });

    ({ stdout: archivedNode } = await run('tar', ['-xOf', verifiedArchivePath, archiveMember], {
      encoding: 'buffer',
      timeout: 60_000,
      maxBuffer: 256 * 1024 * 1024,
    }));
  } finally {
    await rm(verificationRoot, { recursive: true, force: true });
  }

  const cachedNode = await readFile(nodePath);

  if (!archivedNode.equals(cachedNode)) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  await access(nodePath, constants.X_OK);
  assertPinnedDesktopNode(nodePath, platform, architecture);

  return nodePath;
}

export async function prepareDesktopNode({
  platform = process.platform,
  architecture = process.arch,
  toolchainRoot = toolchains,
} = {}) {
  const target = desktopNodeTarget(platform, architecture);
  const root = resolve(toolchainRoot);
  const destination = join(root, `node-${target.target}`);

  let destinationInfo;

  try {
    destinationInfo = await lstat(destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  if (destinationInfo) {
    return await verifyPreparedRuntime(destination, platform, architecture);
  }

  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);

  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    rootInfo.mode & 0o022 ||
    (process.getuid && rootInfo.uid !== process.getuid() && rootInfo.uid !== 0) ||
    (await realpath(root)) !== root
  ) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  const temporaryRoot = await mkdtemp(join(root, '.node-download-'));
  const archivePath = join(temporaryRoot, target.archiveName);
  const extractPath = join(temporaryRoot, 'extracted');

  try {
    const response = await fetch(`https://nodejs.org/dist/v22.23.3/${target.archiveName}`);

    if (!response.ok) {
      throw new Error(`Unable to download pinned Node runtime: HTTP ${response.status}`);
    }

    const archive = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(archive).digest('hex');

    if (digest !== target.archiveSha256) {
      throw new Error('Pinned Node runtime archive checksum mismatch');
    }

    await writeFile(archivePath, archive, { mode: 0o600, flag: 'wx' });
    await mkdir(extractPath, { mode: 0o700 });

    await run('tar', ['-xzf', archivePath, '--strip-components=1', '-C', extractPath], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });

    await writeFile(join(extractPath, 'node-archive.tar.gz'), archive, {
      mode: 0o600,
      flag: 'wx',
    });

    assertPinnedDesktopNode(join(extractPath, 'bin', 'node'), platform, architecture);

    try {
      await rename(extractPath, destination);
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') {
        throw error;
      }
    }

    return await verifyPreparedRuntime(destination, platform, architecture);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nodePath = await prepareDesktopNode();

  process.stdout.write(`${nodePath}\n`);
}
