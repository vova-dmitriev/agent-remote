import { nodeSourceConfig } from './apps/daemon/eslint.config.mjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'apps/desktop/dist/**',
      'apps/desktop/out/**',
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
    'apps/chrome-extension/src/**/*.{ts,js,mjs}',
    'apps/desktop/**/*.{ts,js,mjs,cjs}',
    'packages/**/*.{ts,js,mjs}',
    'scripts/**/*.{ts,js,mjs}',
    'eslint/**/*.mjs',
    'tests/**/*.{ts,js,mjs}',
    '*.{ts,js,mjs}',
  ]),
];
