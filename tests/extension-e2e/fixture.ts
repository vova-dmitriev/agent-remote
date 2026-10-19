import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import { RuntimeEvent } from '../../apps/daemon/src/domain/runtime.js';
import { localFixture } from '../helpers/local-runtime.js';
import { startLocalServer } from '../../apps/daemon/src/local/server/server.js';
import { BrowserKind, NATIVE_HOST_NAME } from '@protocol';
import { shellQuote } from '../../apps/daemon/src/shell/index.js';
import type { ExtensionHarness } from './support/types.js';
import { localProfileFixture } from './support/profiles.js';
import { captureDiagnostics } from './support/diagnostics.js';
import { SESSION_CARD_IDS } from '../../apps/mini-app/src/entities/session/config/test-ids.js';

export const test = base.extend<{ extension: ExtensionHarness }>({
  extension: async ({ browserName }, use) => {
    if (browserName !== BrowserKind.Chromium) {
      throw new Error('Extension E2E requires Chromium');
    }

    const directory = await mkdtemp('/tmp/agent-ext-');
    const profile = join(directory, 'profile');
    const extensionPath = resolve('dist/chrome-extension');
    const runtime = localFixture(directory);
    const profiles = await localProfileFixture(runtime, directory);
    const path = join(directory, 'client.sock');
    const capability = randomBytes(32).toString('hex');

    const server = await startLocalServer({
      path,
      capability,
      controller: runtime.controller,
      grants: runtime.grants,
    });

    let context: BrowserContext | undefined;
    const errors: string[] = [];

    try {
      const settings = join(directory, 'settings.json');
      const executable = join(directory, 'native-host');
      const entry = join(directory, 'native-host.mjs');
      const bundled = join(directory, 'runtime');

      await build({
        configFile: false,
        ssr: { noExternal: true },
        logLevel: 'error',
        build: {
          ssr: resolve('apps/daemon/src/browser/host/bridge.ts'),
          outDir: bundled,
          rollupOptions: { output: { entryFileNames: 'bridge.mjs' } },
        },
      });

      const bridge = pathToFileURL(join(bundled, 'bridge.mjs')).href;

      await writeFile(
        entry,
        `import { readFile } from 'node:fs/promises';\nimport { runNativeHost } from ${JSON.stringify(bridge)};\nconst settings = JSON.parse(await readFile(process.argv[2], 'utf8'));\nawait runNativeHost({input:process.stdin, output:process.stdout}, {...settings, origin:process.argv[3]});\n`,
        { mode: 0o600 },
      );

      await writeFile(settings, JSON.stringify({ path, capability }), { mode: 0o600 });

      await writeFile(
        executable,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)} ${shellQuote(settings)} "$@" 2>>${shellQuote(join(directory, 'host.log'))}\n`,
        { mode: 0o700 },
      );

      const browserEnv = { ...process.env };

      delete browserEnv.NODE_OPTIONS;
      delete browserEnv.NODE_CHANNEL_FD;
      delete browserEnv.NODE_UNIQUE_ID;

      context = await chromium.launchPersistentContext(profile, {
        env: browserEnv,
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });

      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      const origin = `chrome-extension://${id}/`;
      const hosts = join(profile, 'NativeMessagingHosts');

      await mkdir(hosts, { recursive: true, mode: 0o700 });

      await writeFile(
        join(hosts, NATIVE_HOST_NAME + '.json'),
        JSON.stringify({
          name: NATIVE_HOST_NAME,
          description: 'Synthetic E2E companion',
          path: executable,
          type: 'stdio',
          allowed_origins: [origin],
        }),
        { mode: 0o600 },
      );

      runtime.grants.replaceOrigins([origin]);
      const current = context;

      const open = async () => {
        const page = await current.newPage();

        page.on('pageerror', (error) => errors.push(error.message));

        page.on('console', (message) => {
          if (message.text().includes('Content Security Policy')) {
            errors.push(message.text());
          }
        });

        await page.goto(origin + 'extension.html');

        return page;
      };

      const first = await open();

      await expect
        .poll(() => runtime.grants.pending(), {
          message: 'Native host handshake reached private companion',
          timeout: 15000,
        })
        .toHaveLength(1);

      const pending = runtime.grants.pending()[0]!;

      runtime.grants.approve(pending.clientId, pending.origin);
      await first.close();

      await use({
        context: current,
        clientId: pending.clientId,
        open,
        runtime,
        profiles,
        errors,
        status: (value) => {
          const session = runtime.monitor.session(runtime.session.id)!;

          session.status = value;
          session.lastEventAt = Date.now();
          runtime.monitor.emit(RuntimeEvent.Snapshot);
        },
      });

      expect(errors).toEqual([]);
    } catch (error) {
      await context
        ?.pages()
        .at(-1)
        ?.screenshot({ path: '/tmp/extension-e2e-failure.png' })
        .catch(() => {});

      const diagnostic =
        errors.join('\n') +
        '\n' +
        (await readFile(join(directory, 'host.log'), 'utf8').catch(() => 'No native host process log'));

      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostic}`, {
        cause: error,
      });
    } finally {
      await context?.close();
      await server.close();
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});

export async function selectSession(page: Page) {
  await page.getByTestId(SESSION_CARD_IDS.root).click();
}

test.afterEach(async ({ extension }, info) => {
  await captureDiagnostics(extension, info);
});
