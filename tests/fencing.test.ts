import { describe, it, expect } from 'vitest';
import { DeviceFence } from '../apps/server/src/devices/fence.js';

describe('per-device operation fence', () => {
  it('finishes in-flight device writes before replacing its epoch while other devices progress', async () => {
    const fence = new DeviceFence();
    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const order: string[] = [];

    const old = fence.run('a', async () => {
      order.push('old-start');
      await gate;
      order.push('old-finished');
    });

    const replacement = fence.run('a', async () => {
      order.push('new-authenticated');
    });

    await fence.run('b', async () => {
      order.push('other-device');
    });

    expect(order).toEqual(['old-start', 'other-device']);
    release();
    await Promise.all([old, replacement]);
    expect(order).toEqual(['old-start', 'other-device', 'old-finished', 'new-authenticated']);
  });

  it('does not poison subsequent operations when one fails', async () => {
    const fence = new DeviceFence();

    await expect(
      fence.run('a', async () => {
        throw new Error('FAILED');
      }),
    ).rejects.toThrow('FAILED');

    await expect(fence.run('a', async () => 42)).resolves.toBe(42);
  });
});
