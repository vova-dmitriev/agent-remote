import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyDesktopRuntime } from './verify-runtime-lib.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const desktopDirectory = join(repository, 'apps/desktop');
const outputDirectory = join(desktopDirectory, 'out');
const untrusted = () => new Error('LOCAL_RUNTIME_UNTRUSTED');

function inside(parent, target) {
  const path = relative(parent, target);

  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function ownedDirectory(path) {
  const info = await lstat(path);

  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o022 ||
    (process.getuid && info.uid !== process.getuid() && info.uid !== 0) ||
    (await realpath(path)) !== path
  ) {
    throw untrusted();
  }
}

export async function removePackagerMetadata(resourceRoot) {
  const root = resolve(resourceRoot);

  if (!isAbsolute(resourceRoot) || root !== resourceRoot) {
    throw untrusted();
  }

  await ownedDirectory(root);
  const manifestPath = join(root, 'runtime-manifest.json');
  const manifestInfo = await lstat(manifestPath);

  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    manifestInfo.nlink !== 1 ||
    manifestInfo.size > 1_000_000 ||
    manifestInfo.mode & 0o022 ||
    (process.getuid && manifestInfo.uid !== process.getuid() && manifestInfo.uid !== 0)
  ) {
    throw untrusted();
  }

  const manifestFile = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest;

  try {
    const opened = await manifestFile.stat();

    if (opened.ino !== manifestInfo.ino || opened.dev !== manifestInfo.dev) {
      throw untrusted();
    }

    manifest = JSON.parse(await manifestFile.readFile('utf8'));
  } finally {
    await manifestFile.close();
  }

  if (!Array.isArray(manifest.files) || manifest.files.some((file) => file?.path === '.DS_Store')) {
    throw untrusted();
  }

  const metadataPath = join(root, '.DS_Store');
  let metadataInfo;

  try {
    metadataInfo = await lstat(metadataPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }

  if (
    !metadataInfo.isFile() ||
    metadataInfo.isSymbolicLink() ||
    metadataInfo.nlink !== 1 ||
    metadataInfo.size > 1_000_000 ||
    metadataInfo.mode & 0o022 ||
    (process.getuid && metadataInfo.uid !== process.getuid() && metadataInfo.uid !== 0)
  ) {
    throw untrusted();
  }

  const metadata = await open(metadataPath, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const opened = await metadata.stat();

    if (opened.ino !== metadataInfo.ino || opened.dev !== metadataInfo.dev || opened.nlink !== 1) {
      throw untrusted();
    }
  } finally {
    await metadata.close();
  }

  await rm(metadataPath);

  return true;
}

export async function finalizePackagedDesktop({ outputPaths, platform, arch }) {
  if (platform !== 'darwin' || !Array.isArray(outputPaths) || outputPaths.length === 0) {
    throw untrusted();
  }

  const app = JSON.parse(await readFile(join(desktopDirectory, 'package.json'), 'utf8'));
  const limits = await import(pathToFileURL(join(repository, 'dist/packages/protocol/src/local-limits.js')));
  const outputRoot = await realpath(outputDirectory);
  const results = [];

  for (const outputPath of outputPaths) {
    const canonicalOutput = resolve(outputPath);

    if (!isAbsolute(outputPath) || canonicalOutput !== outputPath || !inside(outputRoot, canonicalOutput)) {
      throw untrusted();
    }

    const canonicalParent = await realpath(canonicalOutput);

    if (canonicalParent !== canonicalOutput) {
      throw untrusted();
    }

    const appPath = canonicalOutput.endsWith('.app')
      ? canonicalOutput
      : join(canonicalOutput, `${app.name}.app`);

    await ownedDirectory(appPath);

    const resourceRoot = join(appPath, 'Contents', 'Resources', 'desktop-companion');

    await ownedDirectory(resourceRoot);
    await removePackagerMetadata(resourceRoot);

    results.push(
      await verifyDesktopRuntime({
        resourceRoot,
        platform,
        architecture: arch,
        appVersion: app.version,
        protocolVersion: limits.LOCAL_LIMITS.protocolVersion,
      }),
    );
  }

  return results;
}
