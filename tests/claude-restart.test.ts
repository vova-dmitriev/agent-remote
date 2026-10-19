import { expect, it, vi } from 'vitest';
import { restartClaudeSession } from '../apps/daemon/src/sessions/restart-session.js';
import { sessionSchema, noCapabilities } from '@protocol';

const session = sessionSchema.parse({
  id: 'remote-original',
  generation: 'g',
  target: {
    kind: 'claude-code-cli',
    deviceId: 'device',
    connectorId: 'native',
    claudeSessionId: 'original-native',
  },
  claudeSessionId: 'original-native',
  status: 'idle',
  binding: 'unverified',
  lastEventAt: 1,
  cwd: '/synthetic/project',
  capabilities: { ...noCapabilities, restartSession: true },
  integrationState: 'needs_restart',
  statusConfidence: 'inferred',
});

it('stops the exact verified native process before resuming the original conversation in an owned launcher', async () => {
  const steps: string[] = [];

  const restart = await restartClaudeSession(session, {
    directory: '/private/state',
    capture: async () => ({
      executable: '/synthetic/claude',
      args: ['--resume', 'original-native'],
      env: {},
    }),
    validate: async (path) => path,
    resolve: async () => ({ pid: 123, procStart: 'start', cwd: session.cwd!, sessionId: 'original-native' }),
    stop: async () => {
      steps.push('stop');
    },
    launch: async (options) => {
      steps.push('launch:' + options.resumeId);

      return 'wrapper';
    },
    wait: async () => session.id,
  });

  expect(restart).toBe(session.id);
  expect(steps).toEqual(['stop', 'launch:original-native']);
});

it('does not launch a second writer after a changed identity or an uncertain stop', async () => {
  const launch = vi.fn();

  await expect(
    restartClaudeSession(session, {
      directory: '/private/state',
      capture: async () => ({
        executable: '/synthetic/claude',
        args: ['--resume', 'original-native'],
        env: {},
      }),
      validate: async (path) => path,
      resolve: async () => undefined,
      stop: async () => {},
      launch,
      wait: async () => '',
    }),
  ).rejects.toThrow('STALE_SESSION');

  expect(launch).not.toHaveBeenCalled();

  await expect(
    restartClaudeSession(session, {
      directory: '/private/state',
      capture: async () => ({
        executable: '/synthetic/claude',
        args: ['--resume', 'original-native'],
        env: {},
      }),
      validate: async (path) => path,
      resolve: async () => ({
        pid: 123,
        procStart: 'start',
        cwd: session.cwd!,
        sessionId: 'original-native',
      }),
      stop: async () => {
        throw new Error('UNKNOWN_AFTER_WRITE');
      },
      launch,
      wait: async () => '',
    }),
  ).rejects.toThrow('UNKNOWN_AFTER_WRITE');

  expect(launch).not.toHaveBeenCalled();
});

it('captures arguments and environment and verifies the original cmux target before stopping anything', async () => {
  const stop = vi.fn(),
    launch = vi.fn();

  const context = {
    executable: '/synthetic/claude',
    args: ['--dangerously-skip-permissions', '--model', 'synthetic', '--resume', 'original-native'],
    env: {
      CMUX_SURFACE_ID: '33333333-3333-4333-8333-333333333333',
      CMUX_WORKSPACE_ID: '22222222-2222-4222-8222-222222222222',
      SYNTHETIC_SECRET: 'private test value',
    },
  };

  await expect(
    restartClaudeSession(session, {
      directory: '/private/state',
      validate: async (path) => path,
      resolve: async () => ({
        pid: 123,
        procStart: 'start',
        cwd: session.cwd!,
        sessionId: 'original-native',
      }),
      capture: async () => context,
      prepare: async () => {
        throw new Error('CMUX_CONTEXT_UNAVAILABLE');
      },
      stop,
      launch,
      wait: async () => '',
    }),
  ).rejects.toThrow('CMUX_CONTEXT_UNAVAILABLE');

  expect(stop).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();

  const cmux = {
    windowId: '11111111-1111-4111-8111-111111111111',
    workspaceId: context.env.CMUX_WORKSPACE_ID,
    surfaceId: context.env.CMUX_SURFACE_ID,
  };

  await restartClaudeSession(session, {
    directory: '/private/state',
    validate: async (path) => path,
    resolve: async () => ({ pid: 123, procStart: 'start', cwd: session.cwd!, sessionId: 'original-native' }),
    capture: async () => context,
    prepare: async () => cmux,
    stop,
    launch: async (options) => {
      expect(options.launchContext).toEqual({
        ...context,
        env: { ...context.env, CMUX_WINDOW_ID: cmux.windowId },
      });

      expect(options.cmux).toEqual(cmux);

      return 'wrapper';
    },
    wait: async () => session.id,
  });

  expect(stop).toHaveBeenCalledOnce();
});
