import { vi, expect } from 'vitest';
import {
  BindingState,
  DeviceStatus,
  FrameType,
  IntegrationState,
  SessionStatus,
  StatusConfidence,
  TargetKind,
  LocalKind,
} from '@protocol';
import type { ChromeApi, ChromePort } from '@extension/config/chrome-api.js';
import { ExtensionConnection } from '@extension/client/connection.js';

export function broker() {
  const messages = new Set<(message: unknown, port: ChromePort) => void>();
  const disconnects = new Set<(port: ChromePort) => void>();
  const sent: Record<string, unknown>[] = [];
  const stored: Record<string, unknown> = {};

  const port: ChromePort = {
    name: 'agent-remote-viewer',
    onMessage: { addListener: (fn) => messages.add(fn), removeListener: (fn) => messages.delete(fn) },
    onDisconnect: {
      addListener: (fn) => disconnects.add(fn),
      removeListener: (fn) => disconnects.delete(fn),
    },
    postMessage: (value) => sent.push(value as Record<string, unknown>),
    disconnect: () => {
      for (const fn of disconnects) {
        fn(port);
      }
    },
  };

  const chrome = {
    runtime: { connect: () => port },
    storage: {
      local: {
        get: async () => stored,
        set: async (value: Record<string, unknown>) => {
          Object.assign(stored, value);
        },
      },
    },
  } as unknown as ChromeApi;

  const reply = (value: unknown) => {
    for (const fn of messages) {
      fn(value, port);
    }
  };

  const connection = new ExtensionConnection(chrome);

  const ready = async () => {
    const started = connection.start();

    await vi.waitFor(() => expect(sent.length).toBe(1));

    reply({
      kind: LocalKind.Result,
      requestId: sent[0]!.requestId,
      ok: true,
      data: { lease: 'lease-1', handle: 'opaque', ownerId: 'owner', deviceId: 'device' },
    });

    await started;
  };

  return { connection, ready, reply, sent, port, stored };
}

export function snapshotFrame() {
  return {
    type: FrameType.Snapshot,
    connectors: [],
    deviceId: 'device',
    snapshot: {
      sessions: ['a', 'b'].map((id) => ({
        id,
        target: {
          kind: TargetKind.ClaudeCodeCli,
          deviceId: 'device',
          connectorId: 'cli',
          claudeSessionId: id,
        },
        claudeSessionId: id,
        generation: 'generation-' + id,
        status: SessionStatus.Idle,
        binding: BindingState.Verified,
        lastEventAt: 1,
        capabilities: {
          observe: true,
          history: true,
          prompt: true,
          interrupt: true,
          permission: true,
          terminalSnapshot: true,
        },
        integrationState: IntegrationState.Ready,
        statusConfidence: StatusConfidence.Observed,
      })),
      deviceStatus: DeviceStatus.Online,
      cursor: { streamId: 'stream', seq: 0 },
      permissions: [],
      terminal: null,
    },
  };
}
