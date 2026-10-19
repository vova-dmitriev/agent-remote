import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DaemonErrorCode } from '../apps/daemon/src/error-codes.js';
import { ErrorCode, knownErrorCode } from '@protocol';
import { expect, it } from 'vitest';

function violations(source: string, frontend: boolean) {
  const result = spawnSync(
    process.execPath,
    [
      resolve('apps/mini-app/node_modules/eslint/bin/eslint.js'),
      '--stdin',
      '--stdin-filename',
      frontend ? 'src/features/example/ui/example.tsx' : 'apps/daemon/src/example.ts',
      '--config',
      resolve(frontend ? 'apps/mini-app/eslint.config.mjs' : 'apps/daemon/eslint.config.mjs'),
      '--format',
      'json',
    ],
    {
      cwd: frontend ? resolve('apps/mini-app') : process.cwd(),
      input: source,
      encoding: 'utf8',
      timeout: 15000,
    },
  );

  const report = JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }> }>;

  return report[0]!.messages.filter((message) => message.ruleId === 'domain/no-inline-values');
}

function ruleViolations(source: string, filename: string, ruleId: string) {
  const frontend = filename.startsWith('apps/mini-app/');
  const config = frontend ? 'apps/mini-app/eslint.config.mjs' : 'eslint.config.mjs';

  const result = spawnSync(
    process.execPath,
    [
      resolve('apps/mini-app/node_modules/eslint/bin/eslint.js'),
      '--stdin',
      '--stdin-filename',
      frontend ? filename.slice('apps/mini-app/'.length) : filename,
      '--config',
      resolve(config),
      '--format',
      'json',
    ],
    {
      cwd: frontend ? resolve('apps/mini-app') : process.cwd(),
      input: source,
      encoding: 'utf8',
      timeout: 15000,
    },
  );

  const report = JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }> }>;

  return report[0]!.messages.filter((message) => message.ruleId === ruleId);
}

function errorCodeViolations(source: string, filename: string) {
  return ruleViolations(source, filename, 'domain/no-inline-error-codes');
}

for (const frontend of [false, true]) {
  it(`rejects inline lifecycle values, discriminants, schema enums and duplicate unions (${frontend ? 'frontend' : 'daemon'})`, () => {
    for (const source of [
      'const result = { status: "dispatched" };',
      'const prompt = { delivery: "immediate" };',
      'type Connection = "online" | "offline";',
      'const matches = session.status === "idle";',
      'const schema = z.enum(["online", "offline"]);',
      'const pending = ["accepted", "unknown"].includes(result.status);',
      'setConnection("offline");',
      'socket.on("close", () => setConnection("offline"));',
      ...(frontend
        ? [
            'const custom = <SessionComposer connection="offline" />;',
            'const button = <button onClick={() => setConnection("offline")} />;',
          ]
        : []),
      'const state = { status: online ? "online" : "offline" };',
      'session.status = busy ? "running" : "idle";',
      'const has = ["online", "offline"].some(value => value === status);',
      'const item = { status: "inProgress" };',
      'type Prompt = Extract<Command, { type: "prompt" }>;',
    ]) {
      expect(violations(source, frontend).length, source).toBeGreaterThan(0);
    }
  }, 30000);

  it(`accepts constants, property keys, translated copy and platform tokens (${frontend ? 'frontend' : 'daemon'})`, () => {
    for (const source of [
      'const result = { status: CommandStatus.Dispatched };',
      'type Connection = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];',
      'const matches = session.status === SessionStatus.Idle;',
      'const schema = z.enum(DeviceStatus);',
      'const caption = t("online");',
      'type SessionStatusField = Session["status"];',
      'socket.on("error", handleError);',
      'const data = { "online": true };',
    ]) {
      expect(violations(source, frontend)).toEqual([]);
    }
  }, 30000);
}

it.each([
  ['daemon', 'apps/daemon/src/example.ts'],
  ['server', 'apps/server/src/example.ts'],
  ['desktop', 'apps/desktop/src/example.ts'],
  ['protocol', 'packages/protocol/src/example.ts'],
  ['transport', 'packages/transport/src/example.ts'],
  ['application client', 'apps/mini-app/src/shared/api/desktop/application-client.ts'],
])(
  'rejects raw uppercase Error/Fault codes in %s source',
  (_name, filename) => {
    for (const source of [
      "throw new Error('CODEX_DISCONNECTED');",
      'throw new Error(`CODEX_DISCONNECTED`);',
      "throw new Error(('CODEX_DISCONNECTED' as const));",
      "throw new Error(`${'CODEX_DISCONNECTED'}`);",
      "throw new Error('CODEX_' + 'DISCONNECTED');",
      "throw new globalThis.Error('CODEX_DISCONNECTED');",
      "throw new (globalThis['Error'])('CODEX_DISCONNECTED');",
      "throw new globalThis[`Error`]('CODEX_DISCONNECTED');",
      "throw new globalThis['Err' + 'or']('CODEX_DISCONNECTED');",
      "throw new ((globalThis as typeof globalThis).Error as typeof Error)('CODEX_DISCONNECTED');",
      "throw new ((globalThis as typeof globalThis)['Err' + 'or'] as typeof Error)('CODEX_DISCONNECTED');",
      "throw new Error(...['CODEX_DISCONNECTED']);",
      "throw new Error(...(['CODEX_DISCONNECTED'] as const));",
      "throw new Fault('NOT_FOUND', 404);",
    ]) {
      expect(errorCodeViolations(source, filename), source).not.toHaveLength(0);
    }
  },
  30000,
);

it('accepts named error constants, human messages and platform event tokens', () => {
  for (const [filename, source] of [
    ['apps/daemon/src/example.ts', 'new Error(ErrorCode.NOT_FOUND);'],
    ['apps/server/src/example.ts', 'new Fault(ServerFaultCode.InvalidRequest);'],
    ['apps/desktop/src/example.ts', "new Error('Could not load project');"],
    ['apps/desktop/src/example.ts', "new globalThis.Error('Could not load project');"],
    ['apps/desktop/src/example.ts', "new (globalThis['Error'])('Could not load project');"],
    ['apps/desktop/src/example.ts', "new DOMException('CODEX_DISCONNECTED');"],
    ['apps/desktop/src/example.ts', "new (profile.Error)('CODEX_DISCONNECTED');"],
    ['apps/desktop/src/example.ts', "new globalThis[constructorName]('CODEX_DISCONNECTED');"],
    ['apps/desktop/src/example.ts', "new Error(...['Could not load project']);"],
    ['packages/protocol/src/example.ts', "new Error('close');"],
  ] as const) {
    expect(errorCodeViolations(source, filename)).toEqual([]);
  }
}, 30000);

it('rejects raw uppercase error codes in frontend source', () => {
  expect(
    errorCodeViolations("throw new Error('PROFILE_NOT_READY');", 'apps/mini-app/src/example.ts'),
  ).not.toEqual([]);
}, 30000);

it('keeps private error values outside the protocol known-code fallback', () => {
  expect(knownErrorCode(new Error(DaemonErrorCode.INVALID_CLAUDE_ARGS))).toBe(ErrorCode.REQUEST_FAILED);
  expect(knownErrorCode(new Error(ErrorCode.WRITE_FAILED))).toBe(ErrorCode.WRITE_FAILED);
  expect(knownErrorCode(new Error(ErrorCode.NOT_FOUND))).toBe(ErrorCode.NOT_FOUND);
});

it.each(['apps/daemon/src/example.ts', 'apps/mini-app/src/example.ts'])(
  'requires package aliases instead of relative package source imports in %s',
  (filename) => {
    const relative = "import { ErrorCode } from '../../../../packages/protocol/src/index.js';";

    expect(ruleViolations(relative, filename, 'no-restricted-imports')).not.toHaveLength(0);

    expect(
      ruleViolations("import { ErrorCode } from '@protocol';", filename, 'no-restricted-imports'),
    ).toEqual([]);
  },
  30000,
);

it.each([
  'throw new Fault(ErrorCode.NOT_FOUND, 404);',
  'res.status(404).end();',
  'const gone = response.status === 410;',
  'const response = new Response(null, { status: 405 });',
])(
  'rejects numeric HTTP statuses: %s',
  (source) => {
    expect(ruleViolations(source, 'apps/server/src/example.ts', 'no-restricted-syntax')).not.toHaveLength(0);
  },
  30000,
);

it.each([
  'throw new Fault(ErrorCode.NOT_FOUND, HttpStatus.NotFound);',
  'res.status(HttpStatus.NotFound).end();',
  'const gone = response.status === HttpStatus.Gone;',
  'const response = new Response(null, { status: HttpStatus.MethodNotAllowed });',
])(
  'accepts HttpStatus constants: %s',
  (source) => {
    expect(ruleViolations(source, 'apps/server/src/example.ts', 'no-restricted-syntax')).toEqual([]);
  },
  30000,
);
