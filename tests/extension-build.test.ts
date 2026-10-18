import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const verifier = resolve('scripts/extension/verify-artifact.mjs');
const temporary = mkdtempSync(join(tmpdir(), 'extension-artifact-'));
const artifact = join(temporary, 'artifact');
const runVerifier = (path: string) => spawnSync(process.execPath, [verifier, path], { encoding: 'utf8' });

describe('production extension artifact', () => {
  beforeAll(() => {
    expect(existsSync('scripts/extension/build.mjs'), 'extension build entry exists').toBe(true);
    execFileSync(process.execPath, ['scripts/extension/build.mjs', '--outDir', artifact], { stdio: 'pipe' });
  }, 60_000);

  afterAll(() => rmSync(temporary, { recursive: true, force: true }));

  it('bundles an independent MV3 UI and worker with only native bridge permissions', () => {
    const manifest = JSON.parse(readFileSync(join(artifact, 'manifest.json'), 'utf8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.permissions).toEqual(['sidePanel', 'nativeMessaging', 'storage']);
    expect(manifest.incognito).toBe('not_allowed');
    expect(manifest.side_panel.default_path).toBe('extension.html');
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(readFileSync(join(artifact, 'extension.html'), 'utf8')).not.toMatch(/telegram\.org|\/src\//);
    expect(existsSync(join(artifact, 'background.js'))).toBe(true);
    expect(runVerifier(artifact).status).toBe(0);
  });

  it.each([
    [
      'unexpected permission',
      (path: string) => {
        const file = join(path, 'manifest.json');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));

        manifest.permissions.push('tabs');
        writeFileSync(file, JSON.stringify(manifest));
      },
    ],
    [
      'permissive CSP',
      (path: string) => {
        const file = join(path, 'manifest.json');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));

        manifest.content_security_policy.extension_pages += ' script-src https://example.invalid';
        writeFileSync(file, JSON.stringify(manifest));
      },
    ],
    [
      'JavaScript evaluator CSP',
      (path: string) => {
        const file = join(path, 'manifest.json');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));

        manifest.content_security_policy.extension_pages =
          manifest.content_security_policy.extension_pages.replace("'wasm-unsafe-eval'", "'unsafe-eval'");

        writeFileSync(file, JSON.stringify(manifest));
      },
    ],
    [
      'remote script',
      (path: string) => {
        writeFileSync(
          join(path, 'extension.html'),
          '<script src="https://example.invalid/private-value.js"></script>',
        );
      },
    ],
    [
      'missing script',
      (path: string) => {
        writeFileSync(join(path, 'extension.html'), '<script type="module" src="./missing.js"></script>');
      },
    ],
    [
      'remote imported code',
      (path: string) => {
        writeFileSync(join(path, 'background.js'), 'import("https://example.invalid/private-value.js")');
      },
    ],
    [
      'aliased code evaluator',
      (path: string) => {
        writeFileSync(join(path, 'background.js'), 'const compile = Function; compile("private-value")');
      },
    ],
    [
      'interpolated executable import',
      (path: string) => {
        writeFileSync(join(path, 'background.js'), 'const source="private-value"; import(`./${source}.js`)');
      },
    ],
    [
      'remote worker',
      (path: string) => {
        writeFileSync(join(path, 'background.js'), 'new Worker("https://example.invalid/private-value.js")');
      },
    ],
    [
      'private key',
      (path: string) => {
        writeFileSync(join(path, 'background.js'), '-----BEGIN PRIVATE KEY----- private-value');
      },
    ],
    [
      'development bridge',
      (path: string) => {
        writeFileSync(join(path, 'background.js'), 'window.__EXTENSION_TEST_BRIDGE__ = "private-value"');
      },
    ],
    [
      'unlisted resource',
      (path: string) => {
        writeFileSync(join(path, 'credentials.json'), '{"private-value":true}');
      },
    ],
  ])('rejects %s without printing artifact contents', (name, mutate) => {
    const path = join(temporary, name.replaceAll(' ', '-'));

    cpSync(artifact, path, { recursive: true });
    mutate(path);

    const result = runVerifier(path);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain('private-value');
    expect(result.stderr).toContain('Extension artifact rejected');
  });
});

it('rejects an output nested inside the independent Mini App artifact', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/extension/build.mjs', '--outDir', 'dist/mini-app/extension'],
    { encoding: 'utf8' },
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Extension output must be separate from the Mini App output');
});
