import { cp, lstat, mkdir, readFile, realpath, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { copyCompanionHelper, copyDependencies, copyTree } from './companion-dependencies.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const NativeSignature = { InternalUnsigned: 'internal-unsigned' };

const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

export async function packageCompanion(options) {
  const source = await realpath(options.sourceDirectory ?? repository);
  const identity = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).name;

  if (typeof identity !== 'string' || !identity.trim()) {
    throw new Error('Source package identity is required');
  }

  const output = resolve(options.outputDirectory);

  const limits = await import(
    pathToFileURL(join(source, 'dist/packages/protocol/src/local/local-limits.js')).href
  );

  if (
    !isAbsolute(options.outputDirectory) ||
    !['output', 'artifacts'].includes(relative(source, output).split(sep)[0])
  ) {
    throw new Error('Choose an explicit ignored output/artifacts directory');
  }

  const node = options.nodePath;

  if (!isAbsolute(node) || (await realpath(node)) !== node) {
    throw new Error('Choose a canonical standalone Node executable');
  }

  const stat = await lstat(node);

  if (
    !stat.isFile() ||
    (stat.mode & 0o022) !== 0 ||
    (stat.mode & 0o100) === 0 ||
    (stat.uid !== process.getuid?.() && stat.uid !== 0)
  ) {
    throw new Error('Unsafe standalone Node executable');
  }

  // mkdir without recursive refuses an existing artifact, preventing accidental replacement.
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });

  if ((await realpath(dirname(output))) !== dirname(output)) {
    throw new Error('Output parent must not be a symlink');
  }

  await mkdir(output, { mode: 0o700 });

  for (const path of ['runtime', 'apps/daemon/bin', 'dist/apps', 'dist/packages']) {
    await mkdir(join(output, path), { recursive: true });
  }

  await cp(node, join(output, 'runtime/node'));
  await chmod(join(output, 'runtime/node'), 0o755);
  await cp(join(source, 'apps/daemon/bin/remote.mjs'), join(output, 'apps/daemon/bin/remote.mjs'));
  await copyTree(join(source, 'dist/apps/daemon'), join(output, 'dist/apps/daemon'));
  await copyTree(join(source, 'dist/packages/protocol'), join(output, 'dist/packages/protocol'));
  await copyTree(join(source, 'dist/packages/transport'), join(output, 'dist/packages/transport'));
  await copyDependencies(source, output);
  const helper = await copyCompanionHelper(source, output);

  await writeFile(
    join(output, 'package.json'),
    JSON.stringify({ name: identity, private: true, type: 'module' }),
  );

  const version = JSON.parse(
    execFileSync(
      node,
      [
        '-p',
        'JSON.stringify({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})',
      ],
      { encoding: 'utf8' },
    ),
  );

  const manifest = {
    ...version,
    protocolVersion: limits.LOCAL_LIMITS.protocolVersion,
    signature: NativeSignature.InternalUnsigned,
    helper,
    runtime: {
      nodePath: 'runtime/node',
      entryPath: 'apps/daemon/bin/remote.mjs',
      nodeSha256: await hash(join(output, 'runtime/node')),
      entrySha256: await hash(join(output, 'apps/daemon/bin/remote.mjs')),
    },
  };

  await writeFile(join(output, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  await writeFile(
    join(output, 'SIGNING.txt'),
    'Internal unsigned artifact. Developer ID signing/notarization, maintained Node selection, native helper compatibility and clean macOS acceptance remain release prerequisites. No publication authorized.\n',
  );

  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length !== 4 || args[0] !== '--outDir' || args[2] !== '--node') {
    throw new Error(
      'Usage: node scripts/extension/package-companion.mjs --outDir /absolute/output/companion --node /trusted/standalone/node',
    );
  }

  await packageCompanion({ outputDirectory: args[1], nodePath: args[3] });
}
