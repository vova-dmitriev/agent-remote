import { ErrorCode } from '../../../../packages/protocol/src/index.js';
import { shellQuote as quote } from '../shell/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { cmuxContextSchema, type CmuxContext } from './context.js';

const execute = promisify(execFile);

export type CmuxExecute = (args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

const run: CmuxExecute = async (args, source) => {
  const env = { ...process.env };

  for (const name of ['CMUX_SOCKET_PATH', 'CMUX_SOCKET_PASSWORD', 'CMUX_WORKSPACE_ID', 'CMUX_SURFACE_ID']) {
    if (source[name] !== undefined) {
      env[name] = source[name];
    }
  }

  try {
    return (
      await execute(process.env.CMUX_CLI ?? '/Applications/cmux.app/Contents/Resources/bin/cmux', args, {
        env,
        timeout: 5000,
        maxBuffer: 131072,
      })
    ).stdout;
  } catch {
    throw new Error(ErrorCode.CMUX_CONTEXT_UNAVAILABLE);
  }
};

export async function prepareCmuxContext(
  env: NodeJS.ProcessEnv,
  execute: CmuxExecute = run,
): Promise<CmuxContext | undefined> {
  if (!env.CMUX_WORKSPACE_ID && !env.CMUX_SURFACE_ID) {
    return undefined;
  }

  const workspace = z.uuid().safeParse(env.CMUX_WORKSPACE_ID),
    surface = z.uuid().safeParse(env.CMUX_SURFACE_ID);

  if (!workspace.success || !surface.success) {
    throw new Error(ErrorCode.CMUX_CONTEXT_UNAVAILABLE);
  }

  try {
    const output = JSON.parse(
      await execute(
        [
          '--json',
          '--id-format',
          'uuids',
          'identify',
          '--workspace',
          workspace.data,
          '--surface',
          surface.data,
        ],
        env,
      ),
    );

    const caller = output.caller;

    const context = cmuxContextSchema.parse({
      windowId: caller?.window_id,
      workspaceId: caller?.workspace_id,
      surfaceId: caller?.surface_id,
    });

    if (
      context.workspaceId.toLowerCase() !== workspace.data.toLowerCase() ||
      context.surfaceId.toLowerCase() !== surface.data.toLowerCase()
    ) {
      throw new Error();
    }

    return context;
  } catch {
    throw new Error(ErrorCode.CMUX_CONTEXT_UNAVAILABLE);
  }
}

export async function launchInCmux(
  script: string,
  context: CmuxContext,
  env: NodeJS.ProcessEnv,
  execute: CmuxExecute = run,
) {
  cmuxContextSchema.parse(context);

  await execute(
    [
      'respawn-pane',
      '--window',
      context.windowId,
      '--workspace',
      context.workspaceId,
      '--surface',
      context.surfaceId,
      '--command',
      '/bin/sh ' + quote(script),
    ],
    env,
  );
}
