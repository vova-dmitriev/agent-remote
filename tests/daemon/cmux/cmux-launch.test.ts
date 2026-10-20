import { expect, it } from 'vitest';
import { prepareCmuxContext, launchInCmux } from '../../../apps/daemon/src/cmux/launch.js';

const context = {
  windowId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  surfaceId: '33333333-3333-4333-8333-333333333333',
};

const env = {
  CMUX_WORKSPACE_ID: context.workspaceId,
  CMUX_SURFACE_ID: context.surfaceId,
  CMUX_SOCKET_PATH: '/synthetic/cmux.sock',
};

it('resolves the original surface without focused-target fallback and launches only into that exact cmux surface', async () => {
  const calls: string[][] = [];

  const execute = async (args: string[]) => {
    calls.push(args);

    return JSON.stringify({
      caller: {
        window_id: context.windowId,
        workspace_id: context.workspaceId,
        surface_id: context.surfaceId,
      },
    });
  };

  expect(await prepareCmuxContext(env, execute)).toEqual(context);
  await launchInCmux("/private/a'$(touch NOT_EXECUTED).command", context, env, execute);
  expect(calls[0]).toContain(context.surfaceId);

  expect(calls[1]).toEqual([
    'respawn-pane',
    '--window',
    context.windowId,
    '--workspace',
    context.workspaceId,
    '--surface',
    context.surfaceId,
    '--command',
    "/bin/sh '/private/a'\\''$(touch NOT_EXECUTED).command'",
  ]);
});

it('fails before process stop when cmux access or the original surface cannot be verified', async () => {
  await expect(
    prepareCmuxContext(env, async () => {
      throw new Error('DENIED');
    }),
  ).rejects.toThrow('CMUX_CONTEXT_UNAVAILABLE');

  await expect(
    prepareCmuxContext(env, async () =>
      JSON.stringify({
        focused: {
          window_id: context.windowId,
          workspace_id: context.workspaceId,
          surface_id: context.surfaceId,
        },
      }),
    ),
  ).rejects.toThrow('CMUX_CONTEXT_UNAVAILABLE');

  expect(await prepareCmuxContext({})).toBeUndefined();
});
