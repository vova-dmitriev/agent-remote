import { nodeSourceConfig } from './apps/daemon/eslint.config.mjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'artifacts/**',
      'output/**',
      '.superpowers/**',
      'apps/mini-app/**',
      'tests/e2e/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...nodeSourceConfig([
    'apps/daemon/**/*.{ts,js,mjs}',
    'apps/server/src/**/*.{ts,js,mjs}',
    'packages/**/*.{ts,js,mjs}',
    'scripts/**/*.{ts,js,mjs}',
    'eslint/**/*.mjs',
    'tests/**/*.{ts,js,mjs}',
    '*.{ts,js,mjs}',
  ]),
];
