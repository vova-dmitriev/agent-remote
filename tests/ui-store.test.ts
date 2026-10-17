import { describe, it, expect } from 'vitest';
import {
  initialState,
  reduceSessionState,
  canSend,
} from '../apps/mini-app/src/entities/session/model/session-state.js';
import type { AppSnapshot } from '../packages/protocol/src/index.js';

const snapshot: AppSnapshot = {
  sessions: [],
  deviceStatus: 'online',
  cursor: { streamId: 'a', seq: 1 },
  permissions: [],
  terminal: null,
};

describe('Mini App state', () => {
  it('clears every owner-specific value on logout and resync replaces stale state', () => {
    const state = reduceSessionState(initialState(), {
      type: 'snapshot',
      deviceId: 'A',
      snapshot,
      connectors: [],
    });

    expect(state.snapshot).toEqual(snapshot);

    const loggedOut = reduceSessionState(
      {
        ...state,
        selectedId: 'private-session',
        messages: {
          'private-session': [{ id: 'secret', role: 'assistant', text: 'private', occurredAt: 0 }],
        },
      },
      { type: 'logout' },
    );

    expect(loggedOut).toEqual(initialState());

    const fresh = reduceSessionState(state, {
      type: 'snapshot',
      deviceId: 'B',
      snapshot: { ...snapshot, cursor: { streamId: 'b', seq: 0 } },
      connectors: [],
    });

    expect(fresh.deviceId).toBe('B');
    expect(fresh.messages).toEqual({});
  });

  it('blocks offline, unverified or unsupported prompt controls', () => {
    const session = {
      id: 's',
      target: { kind: 'claude-code-cli' as const, deviceId: 'd', connectorId: 'c', claudeSessionId: 's' },
      claudeSessionId: 's',
      generation: 'g',
      status: 'idle' as const,
      binding: 'verified' as const,
      lastEventAt: 1,
      capabilities: {
        observe: true,
        history: true,
        prompt: true,
        interrupt: true,
        permission: true,
        terminalSnapshot: false,
      },
      integrationState: 'ready' as const,
      statusConfidence: 'observed' as const,
    };

    expect(canSend('online', 'online', session, 'prompt')).toBe(true);
    expect(canSend('offline', 'online', session, 'prompt')).toBe(false);
    expect(canSend('online', 'offline', session, 'prompt')).toBe(false);
    expect(canSend('online', 'online', { ...session, binding: 'unverified' }, 'prompt')).toBe(false);
  });
});
