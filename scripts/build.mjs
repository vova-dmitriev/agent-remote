import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync } from 'node:fs';
import { buildNode } from './build/node.mjs';

await buildNode();

mkdirSync('dist/apps/server/src/db/migrations', { recursive: true });
cpSync('apps/server/src/db/migrations', 'dist/apps/server/src/db/migrations', { recursive: true });

execFileSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', 'apps/mini-app', '--config', 'apps/mini-app/vite.config.ts'],
  { stdio: 'inherit' },
);
