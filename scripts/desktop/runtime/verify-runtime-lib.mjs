import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { listRuntimeFiles } from './runtime-files.mjs';
import { DESKTOP_NODE_RELEASE, desktopNodeTarget } from './runtime-pin.mjs';

const manifestSchema = z.strictObject({
  kind: z.literal('desktop-companion'),
  appVersion: z.string(),
  node: z.string(),
  abi: z.string(),
  nodeArchiveSha256: z.string(),
  platform: z.string(),
  arch: z.string(),
  protocolVersion: z.number().int(),
  helperIdentity: z.string(),
  helper: z.strictObject({ path: z.string(), sha256: z.string() }).nullable(),
  addons: z.array(z.strictObject({ path: z.string(), sha256: z.string() })),
  files: z.array(z.strictObject({ path: z.string(), sha256: z.string() })),
  runtime: z.strictObject({
    nodePath: z.string(),
    entryPath: z.string(),
    nodeSha256: z.string(),
    entrySha256: z.string(),
  }),
});

const untrusted = () => new Error('LOCAL_RUNTIME_UNTRUSTED');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const safeRelative = (path) =>
  Boolean(
    path &&
    !isAbsolute(path) &&
    !path.includes('\0') &&
    !path.includes('\\') &&
    !path.split('/').includes('..'),
  );

async function manifestAt(root) {
  try {
    const path = join(root, 'runtime-manifest.json');
    const info = await lstat(path);

    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o022 || info.size > 1_000_000) {
      throw untrusted();
    }

    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      return JSON.parse(await file.readFile('utf8'));
    } finally {
      await file.close();
    }
  } catch {
    throw untrusted();
  }
}

async function verifyFile(root, path, expected, executable = false) {
  if (!safeRelative(path) || !/^[a-f0-9]{64}$/.test(expected)) {
    throw untrusted();
  }

  const target = join(root, path);
  const info = await lstat(target);

  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.mode & 0o022 ||
    (process.getuid && info.uid !== process.getuid() && info.uid !== 0) ||
    (executable && !(info.mode & 0o100))
  ) {
    throw untrusted();
  }

  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const opened = await file.stat();

    if (opened.ino !== info.ino || opened.dev !== info.dev || digest(await file.readFile()) !== expected) {
      throw untrusted();
    }
  } finally {
    await file.close();
  }
}

export async function verifyDesktopRuntime(options) {
  const root = resolve(options.resourceRoot);

  if (!isAbsolute(options.resourceRoot) || root !== options.resourceRoot || (await realpath(root)) !== root) {
    throw untrusted();
  }

  const rootInfo = await lstat(root);

  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.mode & 0o022) {
    throw untrusted();
  }

  const parsed = manifestSchema.safeParse(await manifestAt(root));

  if (!parsed.success) {
    throw untrusted();
  }

  const manifest = parsed.data;
  let nodeTarget;

  try {
    nodeTarget = desktopNodeTarget(options.platform, options.architecture);
  } catch {
    throw untrusted();
  }

  if (
    manifest.appVersion !== options.appVersion ||
    manifest.platform !== options.platform ||
    manifest.arch !== options.architecture ||
    manifest.protocolVersion !== options.protocolVersion ||
    !/^\d+\.\d+\.\d+$/.test(manifest.appVersion) ||
    manifest.helperIdentity !== (manifest.helper ? 'ClaudeRemoteBridge' : 'none') ||
    manifest.node !== DESKTOP_NODE_RELEASE.version ||
    manifest.abi !== DESKTOP_NODE_RELEASE.abi ||
    manifest.nodeArchiveSha256 !== nodeTarget.archiveSha256
  ) {
    throw untrusted();
  }

  await verifyFile(root, manifest.runtime.nodePath, manifest.runtime.nodeSha256, true);
  await verifyFile(root, manifest.runtime.entryPath, manifest.runtime.entrySha256);

  if (manifest.helper) {
    await verifyFile(root, manifest.helper.path, manifest.helper.sha256, true);
  }

  for (const addon of manifest.addons) {
    await verifyFile(root, addon.path, addon.sha256);
  }

  for (const file of manifest.files) {
    await verifyFile(root, file.path, file.sha256);
  }

  const declared = manifest.files.map((file) => file.path).sort();
  const present = await listRuntimeFiles(root);

  if (declared.length !== present.length || declared.some((path, index) => path !== present[index])) {
    throw untrusted();
  }

  const nodePath = join(root, manifest.runtime.nodePath);

  const observed = JSON.parse(
    execFileSync(
      nodePath,
      [
        '-p',
        'JSON.stringify({version:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})',
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
  );

  if (
    observed.version !== manifest.node ||
    observed.abi !== manifest.abi ||
    observed.platform !== manifest.platform ||
    observed.arch !== manifest.arch
  ) {
    throw untrusted();
  }

  return { root, manifest, nodePath, entryPath: join(root, manifest.runtime.entryPath) };
}
