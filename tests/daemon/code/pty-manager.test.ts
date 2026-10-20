import { afterEach, describe, expect, it } from 'vitest';
import { spawn as spawnPty } from 'node-pty';
import { PtySessionManager, type PtyProcess } from '../../../apps/daemon/src/code/pty-session-manager.js';

function fakePty() {
  const writes: string[] = [];
  let killed = false;

  let exit = () => {};

  const pty: PtyProcess = {
    write(text) {
      writes.push(text);
    },
    resize() {},
    kill() {
      killed = true;
      exit();
    },
    onData() {
      return { dispose() {} };
    },
    onExit(listener) {
      exit = () => listener({ exitCode: 0 });

      return { dispose() {} };
    },
  };

  return { pty, writes, exit: () => exit(), isKilled: () => killed };
}

const managers: PtySessionManager[] = [];

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.close());
});

function manager() {
  const children: ReturnType<typeof fakePty>[] = [];

  const m = new PtySessionManager({
    executable: '/local/claude',
    spawn: () => {
      const child = fakePty();

      children.push(child);

      return child.pty;
    },
  });

  managers.push(m);

  return { m, children };
}

describe('PtySessionManager', () => {
  it('requires a local hook binding before remote input and sends bracketed paste', () => {
    const { m, children } = manager();
    const binding = m.start({ id: 'a', cwd: process.cwd() });

    expect(() => m.sendPrompt({ ...binding, claudeSessionId: 's', lease: 'fake' }, 'hello')).toThrow(
      'STALE_PTY_BINDING',
    );

    const remote = m.confirmSession(binding, 'claude-session-a');

    m.sendPrompt(remote, 'Привет\ncontinue');
    expect(children[0]!.writes).toEqual(['\x1b[200~Привет\ncontinue\x1b[201~\r']);
    m.interrupt(remote);
    expect(children[0]!.writes.at(-1)).toBe('\x1b');
    expect(() => m.sendPrompt(remote, '\x1b[201~pwd')).toThrow('INVALID_PROMPT');
  });

  it('keeps local terminal I/O alive on remote disconnect and revokes old leases', () => {
    const { m, children } = manager();
    const binding = m.start({ id: 'a', cwd: process.cwd() });
    const old = m.confirmSession(binding, 's');

    m.disconnectRemote(binding);
    expect(children[0]!.isKilled()).toBe(false);
    m.writeLocal(binding, '\x03');
    expect(children[0]!.writes).toEqual(['\x03']);
    expect(() => m.sendPrompt(old, 'late')).toThrow('STALE_PTY_BINDING');
    const next = m.confirmSession(binding, 's');

    expect(next.lease).not.toBe(old.lease);
    expect(() => m.sendPrompt(old, 'still late')).toThrow('STALE_PTY_BINDING');
    m.sendPrompt(next, 'new');
  });

  it('never replaces an existing child by name and rejects dead generations', () => {
    const { m, children } = manager();
    const original = m.start({ id: 'a', cwd: process.cwd() });
    const remote = m.confirmSession(original, 's');

    expect(() => m.start({ id: 'a', cwd: process.cwd() })).toThrow('PTY_ALREADY_EXISTS');
    expect(children[0]!.isKilled()).toBe(false);
    children[0]!.exit();
    expect(() => m.sendPrompt(remote, 'dead')).toThrow('STALE_PTY_BINDING');
    const restarted = m.start({ id: 'a', cwd: process.cwd() });

    expect(restarted.generation).not.toBe(original.generation);
    expect(() => m.writeLocal(original, 'wrong')).toThrow('STALE_PTY_BINDING');
    expect(() => m.resize(restarted, 0, 24)).toThrow('INVALID_PTY_SIZE');
    m.close();
    expect(children[1]!.isKilled()).toBe(true);
    expect(() => m.start({ id: 'c', cwd: process.cwd() })).toThrow('PTY_MANAGER_CLOSED');
  });

  it('terminates an owned child that ignores SIGHUP and tracks it until exit', async () => {
    let child!: ReturnType<typeof spawnPty>;
    let completeExit!: () => void;
    let ready!: () => void;

    const exited = new Promise<void>((resolve) => {
      completeExit = resolve;
    });

    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });

    const m = new PtySessionManager({
      executable: process.execPath,
      args: ['-e', `process.on('SIGHUP',()=>{}); console.log('READY'); setInterval(()=>{},1000);`],
      spawn(file, args, options) {
        child = spawnPty(file, args, options);
        child.onExit(() => completeExit());

        child.onData((text) => {
          if (text.includes('READY')) {
            ready();
          }
        });

        return child;
      },
    });

    managers.push(m);
    const binding = m.start({ id: 'ignores-hup', cwd: process.cwd() });

    await started;

    const cleanup = setTimeout(() => {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {}
    }, 1_000);

    const startTime = Date.now();

    try {
      m.stop(binding);
      expect(() => m.writeLocal(binding, 'late')).toThrow('STALE_PTY_BINDING');
      await exited;
      expect(Date.now() - startTime).toBeLessThan(800);
    } finally {
      clearTimeout(cleanup);
    }
  });

  it('uses a real PTY for a locally configured process and forwards output', async () => {
    const m = new PtySessionManager({
      executable: process.execPath,
      args: [
        '-e',
        `process.stdin.setRawMode(true); console.log('READY'); process.stdin.on('data',b=>process.stdout.write('INPUT:'+b.toString('hex')+'\\n'));`,
      ],
    });

    managers.push(m);
    const binding = m.start({ id: 'fixture', cwd: process.cwd() });
    let output = '';
    let resolveReady!: () => void;
    let resolveEcho!: () => void;

    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const echoed = new Promise<void>((resolve) => {
      resolveEcho = resolve;
    });

    const subscription = m.onData(binding, (text) => {
      output += text;

      if (output.includes('READY')) {
        resolveReady();
      }

      if (output.includes('INPUT:616263')) {
        resolveEcho();
      }
    });

    await ready;
    m.resize(binding, 100, 30);
    m.writeLocal(binding, 'abc');
    await echoed;
    expect(output).toContain('INPUT:616263');
    subscription.dispose();
  });
});
