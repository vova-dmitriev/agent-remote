import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Cross-app source aliases; `@/` stays the Mini App's own alias.
const appAliases = [
  ['@daemon', './apps/daemon/src'],
  ['@server', './apps/server/src'],
  ['@desktop', './apps/desktop/src'],
  ['@extension', './apps/chrome-extension/src'],
] as const;

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@protocol/private',
        replacement: fileURLToPath(
          new URL('./packages/protocol/src/errors/private-error-codes.ts', import.meta.url),
        ),
      },
      {
        find: /^@protocol$/,
        replacement: fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
      },
      {
        find: '@transport',
        replacement: fileURLToPath(new URL('./packages/transport/src', import.meta.url)),
      },
      ...appAliases.map(([alias, path]) => ({
        find: alias,
        replacement: fileURLToPath(new URL(path, import.meta.url)),
      })),
      { find: '@', replacement: fileURLToPath(new URL('./apps/mini-app/src', import.meta.url)) },
    ],
  },
  test: {
    include: [
      'tests/**/*.test.ts',
      'apps/mini-app/tests/**/*.test.ts',
      'apps/mini-app/src/shared/ui/markdown/**/*.test.ts',
    ],
    testTimeout: 10_000,
    setupFiles: ['tests/setup/quiet-nest-lifecycle.ts'],
  },
});
