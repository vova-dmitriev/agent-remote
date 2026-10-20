import { defineConfig, devices } from '@playwright/test';
import {
  E2E_PREVIEW_ENV,
  E2E_RELAY_ORIGIN_ENV,
  appOrigin,
  appPort,
  relayOrigin,
} from './tests/e2e/runtime/app-origin.js';

export default defineConfig({
  testDir: 'tests/e2e',
  // One test at a time per shard (each starts its own relay), but shards split by test, not by file, to stay even.
  fullyParallel: true,
  workers: 1,
  timeout: 30000,
  use: { baseURL: appOrigin, channel: 'chrome', trace: 'retain-on-failure' },
  projects: [{ name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: {
    // The sharded runner builds the app once and serves it; a direct run uses the dev server.
    command: process.env[E2E_PREVIEW_ENV]
      ? `npx vite preview apps/mini-app --config apps/mini-app/vite.e2e.config.ts --strictPort --port ${appPort}`
      : `npm run dev:app -- --strictPort --port ${appPort}`,
    url: appOrigin,
    reuseExistingServer: false,
    env: { [E2E_RELAY_ORIGIN_ENV]: relayOrigin },
  },
});
