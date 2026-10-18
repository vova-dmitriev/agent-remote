import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/extension-e2e',
  outputDir: 'output/extension-playwright-results',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
});
