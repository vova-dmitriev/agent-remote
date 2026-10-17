import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
