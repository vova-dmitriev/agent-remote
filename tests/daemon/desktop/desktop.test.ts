import { describe, it, expect } from 'vitest';
import { createDesktopSource } from '@daemon/desktop/adapter.js';

describe('Desktop bridge adapter', () => {
  it('keeps Chat free of tool permissions and rejects a changed local binding', async () => {
    const calls: unknown[] = [];
    let stale = false;

    const bridge = {
      request: async (request: unknown) => {
        calls.push(request);

        if (stale) {
          throw new Error('STALE_SESSION');
        }

        return { status: 'dispatched' };
      },
    };

    const { adapter, binding, session } = createDesktopSource(
      'chat',
      'device',
      { bindingId: 'opaque', generation: 'g', canPrompt: true, canInterrupt: true, canHistory: true },
      bridge,
      { inputEnabled: true, permissionsEnabled: true },
    );

    expect(adapter.descriptor().capabilities.permission).toBe(false);
    expect(adapter.descriptor().capabilities.terminalSnapshot).toBe(false);
    expect(session.statusConfidence).toBe('inferred');
    await expect(adapter.sendPrompt(binding, 'hello')).resolves.toEqual({ status: 'dispatched' });
    stale = true;
    await expect(adapter.sendPrompt(binding, 'late')).rejects.toThrow('STALE_SESSION');
    expect(calls).toHaveLength(2);
  });

  it('keeps unsupported history/composer controls disabled with a setup reason', async () => {
    const { adapter, binding } = createDesktopSource(
      'chat',
      'd',
      { bindingId: 'b', generation: 'g', canPrompt: false, canInterrupt: false, canHistory: false },
      {
        request: async () => {
          throw new Error('SHOULD_NOT_CALL');
        },
      },
      { inputEnabled: true, permissionsEnabled: true },
    );

    expect(adapter.descriptor().state).toBe('needs_setup');
    await expect(adapter.sendPrompt(binding, 'hello')).rejects.toThrow('CAPABILITY_UNAVAILABLE');
  });
});
