import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { startClaude } from '@daemon/cli/wrapper.js';
import { startHookServer } from '@daemon/code/hooks/hook-server.js';
import { localSecret, socketPath } from '@daemon/config.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';

it('routes a prompt through a registered hook binding into the exact owned PTY child', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'owned-input-'));
  const oldHome = process.env.CLAUDE_REMOTE_HOME;

  process.env.CLAUDE_REMOTE_HOME = dir;

  const store = new LocalStore(':memory:', 'device'),
    adapters = new AdapterRegistry('device'),
    permissions = new PermissionBroker();

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });
  let running: Promise<number> | undefined;
  let server: Awaited<ReturnType<typeof startHookServer>> | undefined;

  try {
    server = await startHookServer({
      path: socketPath(),
      token: await localSecret(),
      monitor,
      adapters,
      permissions,
      inputEnabled: true,
      permissionsEnabled: false,
    });

    const executable = join(dir, 'claude');

    await writeFile(
      executable,
      `#!${process.execPath}
const fs=require('node:fs'),net=require('node:net');
process.stdin.setRawMode(true);
const socket=net.connect(${JSON.stringify(socketPath())});
socket.on('connect',()=>socket.write(JSON.stringify({type:'hook',token:fs.readFileSync(${JSON.stringify(join(dir, 'local.key'))},'utf8').trim(),wrapperId:process.env.CLAUDE_REMOTE_WRAPPER_ID,payload:{hook_event_name:'SessionStart',session_id:'synthetic-owned'}})+'\\n'));
socket.on('data',()=>{socket.end();console.log('READY');});
process.stdin.on('data',chunk=>{if(String(chunk).includes('synthetic-input')){console.log('RECEIVED_EXACT_INPUT');setTimeout(()=>process.exit(0),60);}});
setTimeout(()=>process.exit(2),4000);
`,
    );

    await chmod(executable, 0o700);
    let output = '';

    const stdin = new PassThrough(),
      stdout = new Writable({
        write(chunk, _encoding, next) {
          output += String(chunk);
          next();
        },
      });

    running = startClaude(
      [],
      { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream },
      undefined,
      { executable, args: [] },
    );

    await vi.waitFor(() => expect(output).toContain('READY'));
    const session = monitor.snapshot().sessions[0]!;

    expect(session.capabilities.prompt).toBe(true);
    expect(session.binding).toBe('verified');
    expect(session.claudeSessionId).toBe('synthetic-owned');

    expect(
      await adapters.resolve(session.target).sendPrompt(monitor.binding(session.id)!, 'synthetic-input'),
    ).toMatchObject({ status: 'dispatched' });

    expect(await running).toBe(0);
    expect(output).toContain('RECEIVED_EXACT_INPUT');
  } finally {
    await running;
    await server?.close();
    permissions.close();
    store.close();

    if (oldHome === undefined) {
      delete process.env.CLAUDE_REMOTE_HOME;
    } else {
      process.env.CLAUDE_REMOTE_HOME = oldHome;
    }

    await rm(dir, { recursive: true, force: true });
  }
});
