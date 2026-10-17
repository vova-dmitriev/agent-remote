import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync } from 'node:fs';

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
});

mkdirSync('dist/apps/server/src/db/migrations', { recursive: true });
cpSync('apps/server/src/db/migrations', 'dist/apps/server/src/db/migrations', { recursive: true });

execFileSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', 'apps/mini-app', '--config', 'apps/mini-app/vite.config.ts'],
  { stdio: 'inherit' },
);
