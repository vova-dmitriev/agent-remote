import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DaemonErrorCode } from '@daemon/error-codes.js';
import { ErrorCode, knownErrorCode } from '@protocol';
import { afterAll, expect, it } from 'vitest';

type Message = { ruleId: string | null };

/**
 * A linter process per config, as `eslint --stdin` would lint, but loaded once: starting ESLint with its config is
 * what took most of each case. Configs stay in separate processes because typescript-eslint keeps global state.
 */
const WORKER = `
import { ESLint } from ${JSON.stringify(pathToFileURL(resolve('node_modules/eslint/lib/api.js')).href)};
const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: process.argv[1] });
process.on('message', async ({ id, source, filePath }) => {
  const [report] = await eslint.lintText(source, { filePath });
  process.send({ id, messages: report.messages.map(({ ruleId }) => ({ ruleId })) });
});
`;

const workers = new Map<
  string,
  { child: ChildProcess; pending: Map<number, (messages: Message[]) => void> }
>();

let next = 0;

afterAll(() => {
  for (const { child } of workers.values()) {
    child.kill();
  }
});

function worker(config: string, cwd: string) {
  const key = config + '\0' + cwd;
  let found = workers.get(key);

  if (!found) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', WORKER, resolve(config)], {
      cwd,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    const pending = new Map<number, (messages: Message[]) => void>();

    child.on('message', ({ id, messages }: { id: number; messages: Message[] }) =>
      pending.get(id)?.(messages),
    );

    found = { child, pending };
    workers.set(key, found);
  }

  return found;
}

/** The messages of one rule for a source linted as if it were the given file, as `eslint --stdin` reports them. */
function lint(source: string, filename: string, config: string, cwd: string, ruleId: string) {
  const { child, pending } = worker(config, cwd);
  const id = next++;

  return new Promise<Message[]>((done) => {
    pending.set(id, (messages) => {
      pending.delete(id);
      done(messages.filter((message) => message.ruleId === ruleId));
    });

    child.send({ id, source, filePath: resolve(cwd, filename) });
  });
}

function violations(source: string, frontend: boolean) {
  return frontend
    ? lint(
        source,
        'src/features/example/ui/example.tsx',
        'apps/mini-app/eslint.config.mjs',
        resolve('apps/mini-app'),
        'domain/no-inline-values',
      )
    : lint(
        source,
        'apps/daemon/src/example.ts',
        'apps/daemon/eslint.config.mjs',
        process.cwd(),
        'domain/no-inline-values',
      );
}

function ruleViolations(source: string, filename: string, ruleId: string) {
  const frontend = filename.startsWith('apps/mini-app/');

  return frontend
    ? lint(
        source,
        filename.slice('apps/mini-app/'.length),
        'apps/mini-app/eslint.config.mjs',
        resolve('apps/mini-app'),
        ruleId,
      )
    : lint(source, filename, 'eslint.config.mjs', process.cwd(), ruleId);
}

function errorCodeViolations(source: string, filename: string) {
  return ruleViolations(source, filename, 'domain/no-inline-error-codes');
}

for (const frontend of [false, true]) {
  it(`rejects inline lifecycle values, discriminants, schema enums and duplicate unions (${frontend ? 'frontend' : 'daemon'})`, async () => {
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
      expect((await violations(source, frontend)).length, source).toBeGreaterThan(0);
    }
  }, 30000);

  it(`accepts constants, property keys, translated copy and platform tokens (${frontend ? 'frontend' : 'daemon'})`, async () => {
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
      expect(await violations(source, frontend)).toEqual([]);
    }
  }, 30000);
}

it.each([
  ['daemon', 'apps/daemon/src/example.ts'],
  ['server', 'apps/server/src/example.ts'],
  ['desktop', 'apps/desktop/src/example.ts'],
  ['protocol', 'packages/protocol/src/example.ts'],
  ['transport', 'packages/transport/src/example.ts'],
  ['application client', 'apps/mini-app/src/app/api/desktop/application-client.ts'],
])(
  'rejects raw uppercase codes in any error class or Fault in %s source',
  async (_name, filename) => {
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
      // Any error class takes its code from a constant, not only the built-in ones.
      "throw new AdapterError('STALE_SESSION');",
      "throw new CodedError('CAPABILITY_UNAVAILABLE');",
    ]) {
      expect(await errorCodeViolations(source, filename), source).not.toHaveLength(0);
    }
  },
  30000,
);

it('accepts named error constants, human messages and platform event tokens', async () => {
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
    expect(await errorCodeViolations(source, filename)).toEqual([]);
  }
}, 30000);

it('rejects raw uppercase error codes in frontend source', async () => {
  expect(
    await errorCodeViolations("throw new Error('PROFILE_NOT_READY');", 'apps/mini-app/src/example.ts'),
  ).not.toEqual([]);
}, 30000);

it('keeps private error values outside the protocol known-code fallback', async () => {
  expect(knownErrorCode(new Error(DaemonErrorCode.INVALID_CLAUDE_ARGS))).toBe(ErrorCode.REQUEST_FAILED);
  expect(knownErrorCode(new Error(ErrorCode.WRITE_FAILED))).toBe(ErrorCode.WRITE_FAILED);
  expect(knownErrorCode(new Error(ErrorCode.NOT_FOUND))).toBe(ErrorCode.NOT_FOUND);
});

it.each(['apps/daemon/src/example.ts', 'apps/mini-app/src/example.ts'])(
  'requires package aliases instead of relative package source imports in %s',
  async (filename) => {
    const relative = "import { ErrorCode } from '../../../../packages/protocol/src/index.js';";

    expect(await ruleViolations(relative, filename, 'no-restricted-imports')).not.toHaveLength(0);

    expect(
      await ruleViolations("import { ErrorCode } from '@protocol';", filename, 'no-restricted-imports'),
    ).toEqual([]);
  },
  30000,
);

it.each([
  'throw new Fault(ErrorCode.NOT_FOUND, 404);',
  'res.status(404).end();',
  'const gone = response.status === 410;',
  'const response = new Response(null, { status: 405 });',
  'res.status(ok ? 204 : 404).end();',
  'throw new Fault(code, cond ? 413 : 400);',
  'res.sendStatus(404);',
  'res.statusCode = 404;',
  'if (res.statusCode >= 400) fail();',
  'if (response.status < 200) fail();',
])(
  'rejects numeric HTTP statuses: %s',
  async (source) => {
    expect(
      await ruleViolations(source, 'apps/server/src/example.ts', 'no-restricted-syntax'),
    ).not.toHaveLength(0);
  },
  30000,
);

it.each([
  'throw new Fault(ErrorCode.NOT_FOUND, HttpStatus.NotFound);',
  'res.status(HttpStatus.NotFound).end();',
  'const gone = response.status === HttpStatus.Gone;',
  'const response = new Response(null, { status: HttpStatus.MethodNotAllowed });',
  "job.status('active');",
  'res.status(ok ? HttpStatus.NoContent : HttpStatus.NotFound).end();',
  'if (res.statusCode >= HttpStatus.BadRequest) fail();',
  'res.statusCode = HttpStatus.NotFound;',
])(
  'accepts HttpStatus constants: %s',
  async (source) => {
    expect(await ruleViolations(source, 'apps/server/src/example.ts', 'no-restricted-syntax')).toEqual([]);
  },
  30000,
);

it.each([
  "socket.close(4001, 'UNAUTHORIZED');",
  'if (event.code === 4003) retry();',
  'if (code === 4003) stop();',
])(
  'rejects numeric WebSocket close codes: %s',
  async (source) => {
    expect(
      await ruleViolations(source, 'apps/daemon/src/example.ts', 'no-restricted-syntax'),
    ).not.toHaveLength(0);
  },
  30000,
);

it.each([
  'socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.Unauthorized);',
  'if (event.code === SocketCloseCode.Revoked) retry();',
  'if (code === SocketCloseCode.Revoked) stop();',
])(
  'accepts WebSocket close code constants: %s',
  async (source) => {
    expect(await ruleViolations(source, 'apps/daemon/src/example.ts', 'no-restricted-syntax')).toEqual([]);
  },
  30000,
);

it.each(['const matches = response.status === 404;', 'socket.close(4001, "UNAUTHORIZED");'])(
  'rejects numeric statuses and close codes in the frontend: %s',
  async (source) => {
    expect(
      await ruleViolations(source, 'apps/mini-app/src/app/api/example.ts', 'no-restricted-syntax'),
    ).not.toHaveLength(0);
  },
  30000,
);

it.each([
  'throw new Error(ErrorCode.NOT_FOUND);',
  'if (error.message === ErrorCode.NOT_FOUND) {}',
  'if (ErrorCode.NOT_FOUND !== error.message) {}',
])(
  'requires CodedError and errorCode comparisons in daemon source: %s',
  async (source) => {
    expect(
      await ruleViolations(source, 'apps/daemon/src/example.ts', 'no-restricted-syntax'),
      source,
    ).not.toHaveLength(0);
  },
  30000,
);

it('allows CodedError, hasErrorCode and argument-less control-flow throws in daemon source', async () => {
  for (const source of [
    'throw new CodedError(ErrorCode.NOT_FOUND);',
    'if (hasErrorCode(error, ErrorCode.NOT_FOUND)) {}',
    'throw new Error();',
  ]) {
    expect(
      await ruleViolations(source, 'apps/daemon/src/example.ts', 'no-restricted-syntax'),
      source,
    ).toEqual([]);
  }
}, 30000);

it('rejects raw error codes in comparisons, throw branches and error properties', async () => {
  for (const source of [
    "if (code === 'STALE_EPOCH') {}",
    "if (error.code !== 'STALE_EPOCH') {}",
    "const body = { error: 'HISTORY_RELOAD_FAILED' };",
    "throw new Error(ready ? 'A_B' : 'C_D');",
    "throw new CodedError(ready ? 'A_B' : 'C_D');",
  ]) {
    expect(await errorCodeViolations(source, 'apps/daemon/src/example.ts'), source).not.toHaveLength(0);
  }

  for (const source of [
    'if (code === ErrorCode.STALE_EPOCH) {}',
    "const body = { error: 'Could not load' };",
    "if (code === 'idle') {}",
  ]) {
    expect(await errorCodeViolations(source, 'apps/daemon/src/example.ts'), source).toEqual([]);
  }
}, 30000);

it('rejects raw error codes in logical fallbacks', async () => {
  expect(
    await errorCodeViolations(
      "throw new CodedError(response.code ?? 'WRAPPER_FAILED');",
      'apps/daemon/src/example.ts',
    ),
  ).not.toHaveLength(0);

  expect(
    await errorCodeViolations(
      'throw new CodedError(response.code ?? ErrorCode.WRAPPER_FAILED);',
      'apps/daemon/src/example.ts',
    ),
  ).toEqual([]);
}, 30000);

it('restricts the message selector to comparison operators', async () => {
  const file = 'apps/daemon/src/example.ts';

  expect(await ruleViolations('const text = prefix + error.message;', file, 'no-restricted-syntax')).toEqual(
    [],
  );

  expect(
    await ruleViolations('if (error.message == code) {}', file, 'no-restricted-syntax'),
  ).not.toHaveLength(0);
}, 30000);

it.each([
  'reject(new Error(ErrorCode.NOT_FOUND));',
  'const make = () => { return new Error(ErrorCode.NOT_FOUND); };',
  'const make = () => new Error(ErrorCode.NOT_FOUND);',
  'finish(new Error(ErrorCode.NOT_FOUND));',
])(
  'requires CodedError for non-throw error construction: %s',
  async (source) => {
    expect(
      await ruleViolations(source, 'apps/daemon/src/example.ts', 'no-restricted-syntax'),
      source,
    ).not.toHaveLength(0);
  },
  30000,
);

it('keeps numeric selectors active alongside human-text disables', async () => {
  expect(
    await ruleViolations(
      '// eslint-disable-next-line no-restricted-syntax -- text\nthrow new Error("text");\nres.status(404);',
      'apps/daemon/src/example.ts',
      'no-restricted-syntax',
    ),
  ).not.toHaveLength(0);
}, 30000);
