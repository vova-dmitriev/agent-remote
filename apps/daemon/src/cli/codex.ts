import { DaemonErrorCode } from '../error-codes.js';
import { CliAction } from '../domain/cli.js';
import { TargetKind } from '@protocol';
import { IpcMessageType } from '../domain/ipc.js';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { localSecret, socketPath, stateDirectory } from '../config.js';
import { requestLocal } from '../code/hooks/ipc.js';
import { codexConnectionSchema } from '../codex/manager.js';
import { ensureManagedCodexSocket } from '../codex/launcher.js';

export async function runCodex(args: string[]) {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const defaultSocket = join(home, 'app-server-control/app-server-control.sock');

  if (args[0] === CliAction.Connect || args[0] === CliAction.Bind) {
    const kinds = { desktop: TargetKind.CodexDesktop, cli: TargetKind.CodexCli } as const;
    const kind = kinds[args[1] as keyof typeof kinds] ?? null;

    if (!kind) {
      throw new Error(DaemonErrorCode.INVALID_CODEX_ARGS);
    }

    let threadId: string | undefined,
      path = kind === TargetKind.CodexDesktop ? join(home, 'ipc/ipc.sock') : defaultSocket;

    for (let index = 2; index < args.length; index++) {
      if (args[index] === '--socket' && args[index + 1]) {
        path = args[++index]!;
      } else if (!threadId && !args[index]!.startsWith('-')) {
        threadId = args[index];
      } else {
        throw new Error(DaemonErrorCode.INVALID_CODEX_ARGS);
      }
    }

    const selection = codexConnectionSchema.parse({
      kind,
      socketPath: path,
      ...(threadId ? { threadId } : {}),
    });

    const result = await requestLocal(
      socketPath(),
      { type: IpcMessageType.CodexConnect, token: await localSecret(), codex: selection },
      60000,
    );

    if (result.code) {
      throw new Error(result.code);
    }

    process.stdout.write(`Codex: ${result.result?.connected ?? 0}\n`);

    return 0;
  }

  if (args.some((arg) => arg === '--remote' || arg.startsWith('--remote='))) {
    throw new Error(DaemonErrorCode.INVALID_CODEX_ARGS);
  }

  const managedSocket = await ensureManagedCodexSocket(stateDirectory());

  const result = await requestLocal(
    socketPath(),
    {
      type: IpcMessageType.CodexConnect,
      token: await localSecret(),
      codex: { kind: TargetKind.CodexCli, socketPath: managedSocket },
    },
    60000,
  );

  if (result.code) {
    throw new Error(result.code);
  }

  const selectedDirectory = args.some(
    (arg) => arg === '--cd' || arg.startsWith('--cd=') || arg.startsWith('-C'),
  );

  const directoryArgs =
    selectedDirectory || args.includes('resume') || args.includes('fork') ? [] : ['--cd', process.cwd()];

  const child = spawn('codex', ['--remote', 'unix://' + managedSocket, ...directoryArgs, ...args], {
    stdio: 'inherit',
    shell: false,
  });

  return new Promise<number>((resolve, reject) => {
    child.once('error', () => reject(new Error(DaemonErrorCode.CODEX_START_FAILED)));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
