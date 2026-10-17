import { CliCommand, CliAction } from './domain/cli.js';
import { IpcMessageType } from './domain/ipc.js';
import { ClaudeHookEvent } from './domain/claude.js';
import { DesktopMode } from './domain/desktop.js';
import { ASCII_CONTROL_CHARACTERS } from './validation/control-characters.js';
import { cmuxContext } from './cmux/context.js';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, localSecret, socketPath } from './config.js';
import { requestLocal } from './code/ipc.js';
import { installHooks, uninstallHooks } from './code/install-hooks.js';
import { startDaemon } from './main.js';
import { startClaude } from './cli/wrapper.js';

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;

  if (command === CliCommand.Personal) {
    const { startPersonal } = await import('./cli/personal.js');

    await startPersonal();

    return;
  }

  if (command === CliCommand.Pair || command === CliCommand.Connect) {
    const { connectMac } = await import('./cli/pairing/connect.js');
    const controller = new AbortController();
    const stop = () => controller.abort();

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    try {
      const options = {
        ...(args[0] ? { relayUrl: args[0] } : {}),
        manual: command === CliCommand.Pair,
        signal: controller.signal,
      };

      const connected = await connectMac(options);

      if (connected) {
        process.stdout.write('Запусти remote start.\n');
      }
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }

    return;
  }

  if (command === CliCommand.Start) {
    const daemon = await startDaemon();

    process.stdout.write('Companion запущен.\n');

    const stop = () => {
      void daemon.close().then(() => {
        process.exitCode = 0;
      });
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    return;
  }

  if (command === CliCommand.Codex) {
    const { runCodex } = await import('./cli/codex.js');

    process.exitCode = await runCodex(args);

    return;
  }

  if (command === CliCommand.RestoreClaude) {
    const { restoreLaunch } = await import('./sessions/restore-launch.js');
    const context = await restoreLaunch(args[0] ?? '');
    const home = process.env.CLAUDE_REMOTE_HOME;
    const launchId = process.env.CLAUDE_REMOTE_LAUNCH_ID;

    for (const name of Object.keys(process.env)) {
      delete process.env[name];
    }

    Object.assign(process.env, context.env);
    delete process.env.CLAUDE_REMOTE_WRAPPER_ID;

    if (home !== undefined) {
      process.env.CLAUDE_REMOTE_HOME = home;
    }

    if (launchId !== undefined) {
      process.env.CLAUDE_REMOTE_LAUNCH_ID = launchId;
    }

    const cmux = context.env.CMUX_SURFACE_ID ? cmuxContext(context.env) : undefined;

    process.exitCode = await startClaude([], { stdin: process.stdin, stdout: process.stdout }, cmux, context);

    return;
  }

  if (command === 'terminal-claude') {
    const executable = process.env.CLAUDE_REMOTE_NATIVE_CLAUDE;

    if (
      !executable ||
      !isAbsolute(executable) ||
      ASCII_CONTROL_CHARACTERS.test(executable) ||
      args.some((arg) => arg.includes('\0'))
    ) {
      throw new Error('INVALID_CLAUDE_ARGS');
    }

    process.exitCode = await startClaude([], { stdin: process.stdin, stdout: process.stdout }, undefined, {
      executable,
      args,
    });

    return;
  }

  if (command === 'shell' && args[0] === CliAction.Install) {
    const { installClaudeShell } = await import('./cli/shell-integration.js');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const executable = (await promisify(execFile)('/usr/bin/which', ['claude'])).stdout.trim();

    const result = await installClaudeShell({
      directory: process.env.CLAUDE_REMOTE_HOME ?? join(homedir(), '.claude-remote'),
      rcPath: join(process.env.ZDOTDIR ?? homedir(), '.zshrc'),
      executable,
      node: process.execPath,
      entry: fileURLToPath(new URL('./sessions/entry.js', import.meta.url)),
    });

    process.stdout.write(
      'Claude terminal integration installed. Open a new terminal or run: source ' +
        JSON.stringify(result.fragment) +
        '\n',
    );

    return;
  }

  if (command === CliCommand.Claude) {
    process.exitCode = await startClaude(args);

    return;
  }

  if (command === CliCommand.Cmux) {
    let remaining = args;
    let windowId: string | undefined;

    if (args[0] === '--window') {
      windowId = args[1];
      remaining = args.slice(2);
    }

    process.exitCode = await startClaude(
      remaining,
      { stdin: process.stdin, stdout: process.stdout },
      cmuxContext(process.env, windowId),
    );

    return;
  }

  if (command === CliCommand.Hooks) {
    const settings = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json');

    if (args[0] === CliAction.Install) {
      const entry = fileURLToPath(new URL('../../../../apps/daemon/bin/remote.mjs', import.meta.url));
      const backup = await installHooks(settings, entry);

      process.stdout.write(
        `Hooks установлены. Backup: ${backup}\nПерезапусти или resume Claude для загрузки новых hooks.\n`,
      );

      return;
    }

    if (args[0] === CliAction.Uninstall) {
      await uninstallHooks(settings);
      process.stdout.write('Hooks Claude Remote удалены.\n');

      return;
    }
  }

  if (command === CliCommand.Hook) {
    try {
      let input = '';

      for await (const chunk of process.stdin) {
        input += chunk.toString();

        if (Buffer.byteLength(input) > 120000) {
          throw new Error('HOOK_TOO_LARGE');
        }
      }

      const payload = JSON.parse(input);
      const token = await localSecret();

      const result = await requestLocal(
        socketPath(),
        {
          type: IpcMessageType.Hook,
          token,
          payload,
          ...(process.env.CLAUDE_REMOTE_WRAPPER_ID
            ? { wrapperId: process.env.CLAUDE_REMOTE_WRAPPER_ID }
            : {}),
        },
        payload.hook_event_name === ClaudeHookEvent.PermissionRequest ? 50000 : 1500,
      );

      process.stdout.write(JSON.stringify(result.output ?? {}) + '\n');
    } catch {
      process.stdout.write('{}\n');
    }

    return;
  }

  if (
    command === CliCommand.Desktop &&
    args[0] === CliAction.Bind &&
    (args[1] === DesktopMode.Chat || args[1] === DesktopMode.Code)
  ) {
    const result = await requestLocal(
      socketPath(),
      { type: IpcMessageType.DesktopBind, token: await localSecret(), mode: args[1] },
      15000,
    );

    if (result.code) {
      throw new Error(result.code);
    }

    process.stdout.write(JSON.stringify(result) + '\n');

    return;
  }

  if (command === CliCommand.Status) {
    const config = await loadConfig();

    process.stdout.write(JSON.stringify({ relayUrl: config.relayUrl, deviceId: config.deviceId }) + '\n');

    return;
  }

  process.stdout.write(
    'remote personal\nremote connect [relayUrl]\nremote pair <https://relay>\nremote start\nremote hooks install|uninstall\nremote shell install\nremote claude [--resume <session-id>]\nremote cmux [--window <uuid>] [--resume <session-id>]\nremote desktop bind chat|code\nremote codex [resume <thread-id>]\nremote codex connect cli|desktop [thread-id] [--socket <absolute-path>]\nremote status\n',
  );
}
