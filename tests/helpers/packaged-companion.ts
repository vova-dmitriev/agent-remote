import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const repository = fileURLToPath(new URL('../../', import.meta.url));

const helper = `#!/bin/sh
while IFS= read -r request; do
  printf '%s\\n' '{"ok":true,"result":[]}'
done
`;

export async function packagedCompanionFixture(
  requestedNodePath = process.execPath,
  options: { temporaryDirectory?: string } = {},
) {
  const root = await realpath(await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'pkg-')));

  try {
    const source = join(root, 'source');
    const output = join(source, 'output', 'companion');
    const artifact = join(root, 'standalone');
    const state = join(root, 's');
    const nodePath = await realpath(requestedNodePath);

    await mkdir(source, { mode: 0o700 });
    const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));

    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: manifest.name, type: 'module', dependencies: manifest.dependencies }),
    );

    for (const part of [
      'apps/daemon/bin',
      'apps/daemon/src',
      'apps/server/src',
      'packages/protocol/src',
      'packages/transport/src',
    ]) {
      await mkdir(join(source, part, '..'), { recursive: true });
      await cp(join(repository, part), join(source, part), { recursive: true });
    }

    for (const file of ['tsconfig.json', 'tsconfig.build.json']) {
      await cp(join(repository, file), join(source, file));
    }

    await symlink(join(repository, 'node_modules'), join(source, 'node_modules'), 'dir');
    const helperDirectory = join(source, 'artifacts/ClaudeRemoteBridge.app/Contents/MacOS');

    await mkdir(helperDirectory, { recursive: true });
    await writeFile(join(helperDirectory, 'ClaudeBridge'), helper, { mode: 0o755 });

    await run(
      nodePath,
      [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(source, 'tsconfig.build.json')],
      {
        cwd: source,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );

    const script = new URL('../../scripts/extension/package-companion.mjs', import.meta.url).href;

    await run(
      nodePath,
      [
        '--input-type=module',
        '-e',
        `import {packageCompanion} from ${JSON.stringify(script)}; await packageCompanion(${JSON.stringify({ sourceDirectory: source, outputDirectory: output, nodePath })});`,
      ],
      { timeout: 30_000 },
    );

    // Relocation prevents falling back to the staging/repository package identity or helper.
    await rename(output, artifact);

    for (const path of ['s', 'h', 'c', 'x', 'tmp']) {
      await mkdir(join(root, path), { mode: 0o700 });
    }

    return {
      root,
      sourceDirectory: source,
      artifact,
      nodePath,
      state,
      environment: {
        PATH: '',
        HOME: join(root, 'h'),
        CLAUDE_REMOTE_HOME: state,
        CLAUDE_CONFIG_DIR: join(root, 'c'),
        CODEX_HOME: join(root, 'x'),
        TMPDIR: join(root, 'tmp'),
        REMOTE_INPUT_ENABLED: '0',
        REMOTE_PERMISSIONS_ENABLED: '0',
      },
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });

    throw error;
  }
}

export async function compileCompanionFixture() {
  await run(
    process.execPath,
    [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(repository, 'tsconfig.build.json')],
    { cwd: repository, timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
}
