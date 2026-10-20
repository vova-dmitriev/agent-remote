import { defineConfig, devices } from '@playwright/test';
import { E2E_RELAY_ORIGIN_ENV, appOrigin, appPort, relayOrigin } from './tests/e2e/runtime/app-origin.js';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: appOrigin, channel: 'chrome', trace: 'retain-on-failure' },
  projects: [{ name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: {
    command: `npm run dev:app -- --strictPort --port ${appPort}`,
    url: appOrigin,
    reuseExistingServer: false,
    env: { [E2E_RELAY_ORIGIN_ENV]: relayOrigin },
  },
});
