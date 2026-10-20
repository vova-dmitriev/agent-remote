import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { rewriteAliases } from './rewrite-aliases.mjs';

const emitted = /\.(?:js|d\.ts)$/;

// tsc leaves path aliases (`@protocol`, `@transport/*`, `@daemon/*`, `@server/*`, ...) untouched, so plain Node cannot run its output until they are made relative.
// Output is staged and moved file by file so concurrent builds never expose un-rewritten files in `dist/`.
export async function buildNode(root = process.cwd()) {
  const base = resolve(root);
  const dist = join(base, 'dist');
  const stage = mkdtempSync(join(base, '.dist-stage-'));

  try {
    execFileSync(
      process.execPath,
      [
        join(base, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(base, 'tsconfig.build.json'),
        '--outDir',
        stage,
      ],
      { cwd: base, stdio: 'inherit' },
    );

    for (const entry of readdirSync(stage, { recursive: true, encoding: 'utf8' })) {
      const staged = join(stage, entry);
      const target = join(dist, entry);

      if (statSync(staged).isDirectory()) {
        continue;
      }

      if (emitted.test(entry)) {
        writeFileSync(staged, rewriteAliases(readFileSync(staged, 'utf8'), target, dist));
      }

      mkdirSync(dirname(target), { recursive: true });
      renameSync(staged, target);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
