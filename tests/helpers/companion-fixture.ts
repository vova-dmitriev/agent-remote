import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export const fixture = `import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const home=process.env.CLAUDE_REMOTE_HOME;
appendFileSync(join(home,'starts'),JSON.stringify(process.argv.slice(2))+'\\n');
writeFileSync(join(home,'ready'),'synthetic');
const timer=setInterval(()=>{
writeFileSync(join(home,'pulse'),String(Date.now()));
if(existsSync(join(home,'stop'))){clearInterval(timer);writeFileSync(join(home,'done'),'done');}
},20);`;

export async function createPackageFixture(directory: string) {
  const sourceDirectory = join(directory, 'source');
  const outputDirectory = join(sourceDirectory, 'output', 'companion');

  const paths = [
    'apps/daemon/bin',
    'dist/apps/daemon/src',
    'dist/packages/protocol/src/local',
    'dist/packages/transport/src',
    'node_modules/synthetic-dependency',
  ];

  for (const path of paths) {
    await mkdir(join(sourceDirectory, path), { recursive: true });
  }

  await writeFile(
    join(sourceDirectory, 'package.json'),
    JSON.stringify({
      name: 'claude-remote',
      type: 'module',
      dependencies: { 'synthetic-dependency': '1.0.0', 'unused-server-dependency': '1.0.0' },
    }),
  );

  await writeFile(join(sourceDirectory, 'private.txt'), 'must stay outside artifact');

  await writeFile(
    join(sourceDirectory, 'apps/daemon/bin/remote.mjs'),
    "import {runCli} from '../../../dist/apps/daemon/src/setup-cli.js';runCli();",
  );

  await writeFile(
    join(sourceDirectory, 'dist/apps/daemon/src/setup-cli.js'),
    "import {value} from 'synthetic-dependency';export function runCli(){process.stdout.write(value)}",
  );

  await writeFile(
    join(sourceDirectory, 'dist/packages/protocol/src/local/local-limits.js'),
    'export const LOCAL_LIMITS={protocolVersion:1};',
  );

  await writeFile(
    join(sourceDirectory, 'node_modules/synthetic-dependency/package.json'),
    JSON.stringify({ name: 'synthetic-dependency', version: '1.0.0', type: 'module', main: 'index.js' }),
  );

  await writeFile(
    join(sourceDirectory, 'node_modules/synthetic-dependency/index.js'),
    "export const value='packaged synthetic';",
  );

  await writeFile(join(sourceDirectory, 'dist/packages/transport/src/index.js'), 'export {};');

  return { sourceDirectory, outputDirectory };
}

export async function stopFixture(directory: string) {
  try {
    await writeFile(join(directory, 'stop'), 'stop');
  } catch {
    return;
  }

  for (let i = 0; i < 50; i++) {
    try {
      await readFile(join(directory, 'done'));

      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function probeAt(directory: string) {
  try {
    await readFile(join(directory, 'ready'));

    return { protocolVersion: 1, instanceId: 'synthetic' };
  } catch {
    return null;
  }
}

export async function waitForFixture(path: string, previous?: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const value = await readFile(path, 'utf8');

      if (previous === undefined || previous !== value) {
        return value;
      }
    } catch {
      /* A detached fixture may still be booting. */
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error('Synthetic child did not report progress');
}
