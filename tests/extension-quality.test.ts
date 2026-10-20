import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface LintMessage {
  ruleId: string | null;
  message: string;
}

function lint(source: string) {
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/eslint/bin/eslint.js'),
      '--config',
      resolve('eslint.config.mjs'),
      '--stdin',
      '--stdin-filename',
      'apps/chrome-extension/src/client/quality-probe.ts',
      '--format',
      'json',
    ],
    { input: source, encoding: 'utf8', timeout: 15_000 },
  );

  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(2);

  const reports = JSON.parse(result.stdout) as Array<{ messages: LintMessage[] }>;

  return { status: result.status, messages: reports.flatMap((report) => report.messages) };
}

describe('extension source quality gate', () => {
  it('applies TypeScript lint to extension files through the root CLI', () => {
    const result = lint('export const unsafe: any = 1;');

    expect(result.status).toBe(1);

    expect(result.messages.some((message) => message.ruleId === '@typescript-eslint/no-explicit-any')).toBe(
      true,
    );
  });

  it.each([
    ['inline state assignment', 'export const connectionState = "offline";'],
    ['duplicate wire union', 'export type ConnectionState = "online" | "offline";'],
    ['extension-only literal', 'export const item = { kind: "agent-remote-viewer" };'],
    ['extension-only duplicate union', 'export type Surface = "agent-remote-viewer" | "native-host";'],
    ['lowercase constant declaration', 'export const invalid = { kind: "agent-remote-viewer" } as const;'],
    ['mutable domain declaration', 'export const Invalid = { kind: "agent-remote-viewer" };'],
  ])('rejects %s in extension source', (_name, source) => {
    const result = lint(source);

    expect(result.status).toBe(1);
    expect(result.messages.some((message) => message.ruleId === 'domain/no-inline-values')).toBe(true);
  });

  it('accepts named domain declarations and their derived union', () => {
    const result = lint(
      [
        'export const ExtensionTransport = { Viewer: "agent-remote-viewer", Native: "native-host" } as const;',
        '',
        'export type ExtensionTransport = (typeof ExtensionTransport)[keyof typeof ExtensionTransport];',
        '',
        'export const item = { kind: ExtensionTransport.Viewer };',
      ].join('\n'),
    );

    expect(result.status).toBe(0);
    expect(result.messages).toEqual([]);
  });
});

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function sourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'extension-source-'));

  temporaryRoots.push(root);

  for (const path of [
    'apps/chrome-extension/src',
    'apps/daemon/src/browser',
    'apps/daemon/src/local',
    'packages/transport/src/native',
    'scripts/extension',
  ]) {
    mkdirSync(join(root, path), { recursive: true });
  }

  return { root, source: join(root, 'apps/chrome-extension/src') };
}

function checkStructure(root: string) {
  return spawnSync(process.execPath, [resolve('scripts/extension/check-source.mjs'), '--root', root], {
    encoding: 'utf8',
  });
}

it('accepts extension slice boundaries at 200 lines and six implementation files', () => {
  const { root, source } = sourceFixture();

  for (let i = 0; i < 6; i++) {
    writeFileSync(join(source, `module-${i}.ts`), 'export const value = true;\n' + '// line\n'.repeat(199));
  }

  writeFileSync(join(source, 'index.ts'), 'export {};\n');
  expect(checkStructure(root).status).toBe(0);
});

it.each(['oversized', 'overcrowded'])('rejects %s extension source before packaging', (kind) => {
  const { root, source } = sourceFixture();

  if (kind === 'oversized') {
    writeFileSync(join(source, 'oversized.ts'), '// private-value\n'.repeat(201));
  } else {
    for (let i = 0; i < 7; i++) {
      writeFileSync(join(source, `module-${i}.ts`), 'export {};\n');
    }
  }

  const result = checkStructure(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Extension source rejected');
  expect(result.stderr).not.toContain('private-value');
});
