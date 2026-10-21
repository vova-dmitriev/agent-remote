import { DaemonErrorCode } from './error-codes.js';
import { CliCommand, CliAction } from './domain/cli.js';
import { HookAgent, IpcMessageType } from './domain/ipc.js';
import { ClaudeHookEvent } from './domain/claude.js';
import { DesktopMode } from './domain/desktop.js';
import { ASCII_CONTROL_CHARACTERS } from './validation/control-characters.js';
import { cmuxContext, hookCmuxSurface } from './cmux/context.js';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, localSecret, multiUserMode, socketPath, stateDirectory } from './config.js';
import { readRelayStatus, relayStatusIsLive } from './diagnostics/relay-status.js';
import { requestLocal } from './code/hooks/ipc.js';
import { deliverHook, hookTargets } from './code/hooks/hook-delivery.js';
import { installHooks, uninstallHooks } from './code/hooks/install-hooks.js';
import { startDaemon } from './main.js';
import { startClaude } from './cli/wrapper.js';
import { CodedError, RULE_ANSWER_TIMEOUT_MS, hasErrorCode } from '@protocol';

/** How long `remote hook` waits for the daemons' first answer: a permission prompt waits, other hooks do not. */
const HOOK_WAIT_MS: Partial<Record<string, number>> = { [ClaudeHookEvent.PermissionRequest]: 50_000 };

/** Once a daemon holds a command for the owner's answer to a rule stop, the hook waits this long. */
const RULE_HOLD_MS = RULE_ANSWER_TIMEOUT_MS + 30_000;

/** Marks a hook Codex runs: `remote hook --agent=codex`. */
const CODEX_HOOK_FLAG = `--agent=${HookAgent.Codex}`;

const codexHooksFile = () => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'hooks.json');

const sessionEntryPath = () => fileURLToPath(new URL('./entry/entry.js', import.meta.url));

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;

  if (command === CliCommand.Profiles) {
    const { runProfilesCli } = await import('./profiles/runtime/native/cli.js');

    await runProfilesCli(args, stateDirectory());

    return;
  }

  if (command === CliCommand.Browser) {
    const { runBrowserCli } = await import('./cli/browser/index.js');

    await runBrowserCli(args);

    return;
  }

  if (command === CliCommand.Personal) {
    const { startPersonal } = await import('./cli/personal/personal.js');

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
        process.stdout.write('Run remote start.\n');
      }
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }

    return;
  }

  if (command === CliCommand.Supervise) {
    const { runSupervisor } = await import('./cli/supervisor/supervisor.js');

    await runSupervisor();

    return;
  }

  if (command === CliCommand.Start) {
    const { claudeShellDirectory, refreshClaudeShellEntry } = await import('./cli/shell-integration.js');

    // A stale terminal integration must not prevent the companion from starting. On a shared VM the shell's
    // `claude` belongs to no single user's daemon, so it is left alone.
    if (!multiUserMode()) {
      await refreshClaudeShellEntry({ directory: claudeShellDirectory(), entry: sessionEntryPath() }).catch(
        () => {
          process.stderr.write(`${DaemonErrorCode.SHELL_INTEGRATION_REFRESH_FAILED}\n`);
        },
      );
    }

    const daemon = await startDaemon().catch((error: unknown) => {
      if (hasErrorCode(error, DaemonErrorCode.HOOK_SOCKET_HELD_BY_COMPANION)) {
        process.stderr.write(
          `${DaemonErrorCode.HOOK_SOCKET_HELD_BY_COMPANION}: ${socketPath()} is held by the Agent Remote desktop companion, which did not release it. Quit Agent Remote and run remote start again.\n`,
        );
      }

      throw error;
    });

    process.stdout.write('Companion started.\n');

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
    const { restoreLaunch } = await import('./sessions/launch/restore-launch.js');
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
      throw new CodedError(DaemonErrorCode.INVALID_CLAUDE_ARGS);
    }

    process.exitCode = await startClaude([], { stdin: process.stdin, stdout: process.stdout }, undefined, {
      executable,
      args,
    });

    return;
  }

  if (command === 'shell' && args[0] === CliAction.Install) {
    const { claudeShellDirectory, installClaudeShell } = await import('./cli/shell-integration.js');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const executable = (await promisify(execFile)('/usr/bin/which', ['claude'])).stdout.trim();

    const result = await installClaudeShell({
      directory: claudeShellDirectory(),
      rcPath: join(process.env.ZDOTDIR ?? homedir(), '.zshrc'),
      executable,
      node: process.execPath,
      entry: sessionEntryPath(),
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
      const codexBackup = await installHooks(codexHooksFile(), entry, HookAgent.Codex);

      process.stdout.write(
        `Hooks installed. Backups: ${backup}, ${codexBackup}\nRestart or resume Claude and Codex to load the new hooks.\n`,
      );

      return;
    }

    if (args[0] === CliAction.Uninstall) {
      await uninstallHooks(settings);
      await uninstallHooks(codexHooksFile());
      process.stdout.write('Claude Remote hooks removed.\n');

      return;
    }
  }

  if (command === CliCommand.Hook) {
    try {
      let input = '';

      for await (const chunk of process.stdin) {
        input += chunk.toString();

        if (Buffer.byteLength(input) > 120000) {
          throw new CodedError(DaemonErrorCode.HOOK_TOO_LARGE);
        }
      }

      const payload = JSON.parse(input);

      // The CLI daemon and a desktop companion both watch this Mac's sessions; the first decision answers.
      const output = await deliverHook(
        await hookTargets(),
        {
          type: IpcMessageType.Hook,
          payload,
          ...(args.includes(CODEX_HOOK_FLAG) ? { agent: HookAgent.Codex } : {}),
          ...(process.env.CLAUDE_REMOTE_WRAPPER_ID
            ? { wrapperId: process.env.CLAUDE_REMOTE_WRAPPER_ID }
            : hookCmuxSurface(process.env)),
        },
        HOOK_WAIT_MS[payload.hook_event_name] ?? 1500,
        RULE_HOLD_MS,
      );

      process.stdout.write(JSON.stringify(output) + '\n');
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
      throw new CodedError(result.code);
    }

    process.stdout.write(JSON.stringify(result) + '\n');

    return;
  }

  if (command === CliCommand.Status) {
    const config = await loadConfig();

    // A record whose companion no longer runs is stale: it is left out.
    const record = await readRelayStatus(stateDirectory());
    const relayStatus = record && relayStatusIsLive(record) ? record.code : undefined;

    process.stdout.write(
      JSON.stringify({
        relayUrl: config.relayUrl,
        deviceId: config.deviceId,
        ...(relayStatus ? { relayStatus } : {}),
      }) + '\n',
    );

    return;
  }

  process.stdout.write(
    'remote personal\nremote connect [relayUrl]\nremote pair <https://relay>\nremote start\nremote hooks install|uninstall\nremote shell install\nremote claude [--resume <session-id>]\nremote cmux [--window <uuid>] [--resume <session-id>]\nremote desktop bind chat|code\nremote codex [resume <thread-id>]\nremote codex connect cli|desktop [thread-id] [--socket <absolute-path>]\nremote status\n',
  );
}
