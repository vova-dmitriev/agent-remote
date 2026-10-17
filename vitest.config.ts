import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/mini-app/src', import.meta.url)),
      '@protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'tests/**/*.test.ts',
      'apps/mini-app/tests/**/*.test.ts',
      'apps/mini-app/src/shared/ui/markdown/**/*.test.ts',
    ],
    testTimeout: 10_000,
  },
});
