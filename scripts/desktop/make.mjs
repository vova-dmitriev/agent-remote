import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDesktopNode } from './prepare-runtime.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(repository, 'apps/desktop');
const requireDesktop = createRequire(resolve(directory, 'package.json'));
const cliManifestPath = requireDesktop.resolve('@electron-forge/cli/package.json');
const cliManifest = JSON.parse(await readFile(cliManifestPath, 'utf8'));
const cli = resolve(dirname(cliManifestPath), cliManifest.bin['electron-forge']);
const nodePath = await prepareDesktopNode();
const requested = process.argv.slice(2);
const args = requested.length ? requested : ['make', '--config', 'forge.config.cjs'];

const child = spawn(nodePath, [cli, ...args], {
  cwd: directory,
  env: { ...process.env, PATH: `${dirname(nodePath)}${delimiter}${process.env.PATH ?? ''}` },
  stdio: 'inherit',
});

child.once('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
