import { spawnSync } from 'node:child_process';

const daemonOnly = process.argv.includes('--daemon');

const sourcePaths = daemonOnly
  ? ['apps/daemon/src', 'apps/daemon/eslint.config.mjs']
  : [
      'apps/daemon/src',
      'apps/daemon/bin',
      'apps/server/src',
      'packages',
      'scripts',
      'eslint',
      'tests',
      '*.{ts,mjs,js}',
      'apps/daemon/eslint.config.mjs',
    ];

const eslintConfig = daemonOnly ? 'apps/daemon/eslint.config.mjs' : 'eslint.config.mjs';
const eslintPaths = daemonOnly ? ['apps/daemon/src'] : ['.'];

const eslintArguments = [
  'node_modules/eslint/bin/eslint.js',
  '--config',
  eslintConfig,
  ...eslintPaths,
  '--fix',
  '--max-warnings=0',
];

const prettier = (mode) => ['node_modules/prettier/bin/prettier.cjs', mode, ...sourcePaths];

function run(args, allowLintErrors = false) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }

  // The first pass may add braces that need reformatting before the final check.
  if (result.status !== 0 && !(allowLintErrors && result.status === 1)) {
    process.exit(result.status ?? 1);
  }
}

run(prettier('--write'));
run(eslintArguments, true);
run(prettier('--write'));
run(eslintArguments);
run(prettier('--check'));
