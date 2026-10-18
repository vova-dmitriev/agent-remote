import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageCompanion } from '../extension/package-companion.mjs';
import { assertPinnedDesktopNode, desktopNodeTarget } from './runtime-pin.mjs';
import { prepareDesktopNode } from './prepare-runtime.mjs';

const repository = resolve(fileURLToPath(new URL('../../', import.meta.url)));

const hashFile = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

const inside = (root, path) => path === root || path.startsWith(`${root}/`);

export async function materializeRuntimeLinks(root, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = await lstat(path);

    if (info.isSymbolicLink()) {
      const target = await realpath(path);

      if (!inside(root, target)) {
        throw new Error('Runtime symlink escapes package root');
      }

      const targetInfo = await stat(path);

      await rm(path, { force: true });
      await cp(target, path, { recursive: targetInfo.isDirectory(), errorOnExist: true, force: false });
      await materializeRuntimeLinks(root, path);
    } else if (entry.isDirectory()) {
      await materializeRuntimeLinks(root, path);
    } else if (!entry.isFile()) {
      throw new Error(`Runtime resources must contain regular files only: ${path}`);
    }
  }
}

async function nativeAddons(root, directory = root) {
  const results = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await nativeAddons(root, path)));
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      results.push({
        path: path
          .slice(root.length + 1)
          .split('\\')
          .join('/'),
        sha256: await hashFile(path),
      });
    }
  }

  return results.sort((left, right) => left.path.localeCompare(right.path));
}

async function runtimeFiles(root, directory = root) {
  const results = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await runtimeFiles(root, path)));
    } else if (entry.isFile()) {
      if (entry.name !== 'runtime-manifest.json') {
        results.push({
          path: path
            .slice(root.length + 1)
            .split('\\')
            .join('/'),
          sha256: await hashFile(path),
        });
      }
    } else {
      throw new Error(`Runtime resources must contain regular files only: ${path}`);
    }
  }

  return results.sort((left, right) => left.path.localeCompare(right.path));
}

export async function packageDesktopRuntime({ outputDirectory, nodePath, sourceDirectory = repository }) {
  const output = resolve(outputDirectory);
  const source = resolve(sourceDirectory);

  if (
    !outputDirectory ||
    output !== outputDirectory ||
    !sourceDirectory ||
    source !== sourceDirectory ||
    !nodePath ||
    !resolve(nodePath)
  ) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  const node = assertPinnedDesktopNode(nodePath, process.platform, process.arch);
  const nodeArchiveSha256 = desktopNodeTarget(node.platform, node.arch).archiveSha256;
  const verifiedNodePath = await prepareDesktopNode();

  if ((await realpath(nodePath)) !== verifiedNodePath) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  const staging = join(source, 'artifacts', `desktop-runtime-${randomUUID()}`);

  await mkdir(join(source, 'artifacts'), { recursive: true });

  try {
    const base = await packageCompanion({
      sourceDirectory: source,
      outputDirectory: staging,
      nodePath,
    });

    await materializeRuntimeLinks(staging);

    const daemonVersion = JSON.parse(
      await readFile(join(repository, 'apps/desktop/package.json'), 'utf8'),
    ).version;

    const manifest = {
      kind: 'desktop-companion',
      appVersion: daemonVersion,
      node: base.node,
      abi: base.abi,
      nodeArchiveSha256,
      platform: base.platform,
      arch: base.arch,
      protocolVersion: base.protocolVersion,
      helperIdentity: base.helper ? 'ClaudeRemoteBridge' : 'none',
      helper: base.helper,
      runtime: base.runtime,
      addons: await nativeAddons(staging),
      files: await runtimeFiles(staging),
    };

    await writeFile(join(staging, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await mkdir(output, { recursive: true, mode: 0o755 });

    for (const entry of await readdir(staging, { withFileTypes: true })) {
      await cp(join(staging, entry.name), join(output, entry.name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }

    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length !== 4 || args[0] !== '--outDir' || args[2] !== '--node') {
    throw new Error(
      'Usage: node scripts/desktop/package-runtime.mjs --outDir /absolute/resources/desktop-companion --node /trusted/standalone/node',
    );
  }

  await packageDesktopRuntime({ outputDirectory: args[1], nodePath: args[3] });
}
