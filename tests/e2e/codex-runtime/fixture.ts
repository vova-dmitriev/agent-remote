import { test as base } from '@playwright/test';
import { runtimeFixture, type Runtime } from './runtime.js';
import type { Kind } from './model.js';

export const test = base.extend<{ runtime: Runtime; kind: Kind }>({
  kind: ['codex-cli', { option: true }],
  runtime: async ({ kind }, use) => {
    const runtime = await runtimeFixture(kind);

    try {
      await use(runtime);
    } finally {
      await runtime.close();
    }
  },
});
