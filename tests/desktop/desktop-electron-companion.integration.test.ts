import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildVite } from 'vite';
import { afterEach, expect, it } from 'vitest';
import type { ElectronApplication } from 'playwright';
import { desktopRuntimeFixture } from '../helpers/desktop/desktop-runtime-fixture.js';
import {
  guardRuntimeProcesses,
  trackRuntimeChild,
  trackRuntimeRoot,
} from '../helpers/desktop/runtime-processes.js';
import { verifyDesktopAuthLinkPolicy } from '../desktop-e2e/auth-link-policy.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const requireDesktop = createRequire(resolve(root, 'apps/desktop/package.json'));
const itOnDarwin = it.skipIf(process.platform !== 'darwin');

guardRuntimeProcesses();

type DesktopEsbuild = {
  build: (options: {
    entryPoints: string[];
    outfile: string;
    bundle: boolean;
    platform: 'node';
    format: 'cjs';
    target: string;
    external: string[];
  }) => Promise<unknown>;
};

let app: ElectronApplication | undefined;
let fixture: string | undefined;
let companion: Awaited<ReturnType<typeof desktopRuntimeFixture>> | undefined;
let peer: ReturnType<typeof spawn> | undefined;

afterEach(async () => {
  try {
    await app?.close();
  } finally {
    // The packaged peer and companion must stop even when the Electron app fails to close.
    const running = peer;

    app = undefined;
    peer = undefined;

    if (running && running.exitCode === null && running.signalCode === null) {
      const exited = new Promise<void>((resolve) => running.once('exit', () => resolve()));

      running.kill('SIGTERM');
      await exited;
    }

    await companion?.close();
    companion = undefined;

    if (fixture) {
      await rm(fixture, { recursive: true, force: true });
      fixture = undefined;
    }
  }
});

itOnDarwin(
  'connects production Electron bootstrap to the packaged companion and reuses its local grant',
  async () => {
    const { _electron: electron } = await import('playwright');
    const electronPath = requireDesktop('electron') as string;
    const { build: buildEsbuild } = requireDesktop('esbuild') as DesktopEsbuild;

    fixture = await mkdtemp(join(tmpdir(), 'desktop-electron-companion-'));
    trackRuntimeRoot(fixture);
    companion = await desktopRuntimeFixture();
    const renderer = join(fixture, 'renderer');
    const main = join(fixture, 'main.cjs');
    const preload = join(fixture, 'preload.cjs');
    const userData = join(companion.root, 'ud');
    const companionHome = join(userData, 'desktop-companion');
    const confirmLog = join(fixture, 'native-confirmation.log');
    const proofLog = join(fixture, 'companion-proof.log');
    const errorLog = join(fixture, 'main-error.log');
    const externalLog = join(fixture, 'external-open.log');

    await mkdir(companionHome, { recursive: true, mode: 0o700 });

    for (const path of [
      join(fixture, 'home'),
      join(fixture, 'claude'),
      join(fixture, 'codex'),
      join(fixture, 'tmp'),
    ]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
    }

    const peerScript = `
import { startDaemon } from './dist/apps/daemon/src/main.js';
const daemon = await startDaemon();
process.stdout.write('DESKTOP_PEER_READY\\n');
process.once('SIGTERM', async () => { await daemon.close(); process.exit(0); });
`;

    const runningPeer = spawn(companion.nodePath, ['--input-type=module', '-e', peerScript], {
      cwd: companion.artifact,
      env: {
        PATH: '',
        HOME: join(fixture, 'home'),
        CLAUDE_REMOTE_HOME: companionHome,
        CLAUDE_CONFIG_DIR: join(fixture, 'claude'),
        CODEX_HOME: join(fixture, 'codex'),
        TMPDIR: join(fixture, 'tmp'),
        REMOTE_INPUT_ENABLED: '0',
        REMOTE_PERMISSIONS_ENABLED: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    peer = runningPeer;
    trackRuntimeChild(runningPeer);
    let peerOutput = '';
    let peerErrors = '';

    runningPeer.stdout?.setEncoding('utf8').on('data', (chunk: string) => (peerOutput += chunk));
    runningPeer.stderr?.setEncoding('utf8').on('data', (chunk: string) => (peerErrors += chunk));

    await expect
      .poll(() => peerOutput.includes('DESKTOP_PEER_READY'), { timeout: 30_000 })
      .toBe(true)
      .catch(() => {
        throw new Error(`Packaged daemon failed (exit=${runningPeer.exitCode}, stderr=${peerErrors})`);
      });

    await buildVite({
      configFile: resolve(root, 'apps/mini-app/vite.desktop.config.ts'),
      build: { outDir: renderer },
    });

    await buildEsbuild({
      entryPoints: [resolve(root, 'tests/desktop-e2e/fixture-main-companion.ts')],
      outfile: main,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
    });

    await buildEsbuild({
      entryPoints: [resolve(root, 'apps/desktop/src/preload/index.ts')],
      outfile: preload,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
    });

    const launchViewer = () =>
      electron.launch({
        executablePath: electronPath,
        args: [main],
        env: {
          PATH: process.env.PATH ?? '',
          HOME: join(fixture!, 'home'),
          DESKTOP_FIXTURE_ASSET_ROOT: renderer,
          DESKTOP_FIXTURE_PRELOAD_PATH: preload,
          DESKTOP_FIXTURE_RESOURCE_ROOT: companion!.resourceRoot,
          DESKTOP_FIXTURE_USER_DATA: userData,
          DESKTOP_FIXTURE_CONFIRM_LOG: confirmLog,
          DESKTOP_FIXTURE_PROOF_LOG: proofLog,
          DESKTOP_FIXTURE_ERROR_LOG: errorLog,
          DESKTOP_FIXTURE_EXTERNAL_LOG: externalLog,
        },
      });

    app = await launchViewer();
    let page = await app.firstWindow();

    await page.waitForLoadState('domcontentloaded');
    await expect.poll(() => page.locator('#root > *').count()).toBeGreaterThan(0);
    expect(new URL(page.url()).protocol).toBe('agent-remote:');
    expect(await page.evaluate(() => typeof window.Telegram)).toBe('undefined');
    // The desktop shell keeps its route in the fragment; bridge IPC must stay trusted with it.
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toBe('#/');

    await verifyDesktopAuthLinkPolicy(page, externalLog);

    await expect.poll(() => app?.windows().length ?? 0).toBe(1);
    await expect.poll(() => readFile(proofLog, 'utf8').catch(() => '')).toEqual('1\n');
    expect(await page.evaluate(() => typeof window.desktopBridge)).toBe('object');
    expect((await readFile(confirmLog, 'utf8')).trim().split('\n')).toEqual(['confirmed']);
    await app.close();
    app = undefined;
    expect(runningPeer.exitCode).toBeNull();

    app = await launchViewer();
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect.poll(() => readFile(proofLog, 'utf8').catch(() => '')).toEqual('1\n1\n');
    expect((await readFile(confirmLog, 'utf8')).trim().split('\n')).toEqual(['confirmed']);
    expect(runningPeer.exitCode).toBeNull();
  },
  120_000,
);
