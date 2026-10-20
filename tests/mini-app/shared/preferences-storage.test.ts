import { afterEach, expect, it, vi } from 'vitest';
import { preferenceStorage } from '@/shared/lib/preferences/storage.js';

const identity = (id: number) => new URLSearchParams({ user: JSON.stringify({ id }) }).toString();

afterEach(() => vi.unstubAllGlobals());

it('keeps pending choices separate by Telegram account and removes an acknowledged outbox', () => {
  const values = new Map<string, string>();

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });

  const first = preferenceStorage(identity(1));
  const second = preferenceStorage(identity(2));

  first.write({ theme: 'dark' });
  second.write({ language: 'en' });
  expect(preferenceStorage(identity(1)).read()).toEqual({ theme: 'dark' });
  expect(preferenceStorage(identity(2)).read()).toEqual({ language: 'en' });
  first.write({});
  expect(first.read()).toEqual({});
  expect(second.read()).toEqual({ language: 'en' });
});

it('ignores malformed or unscoped storage and continues when storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => '{"theme":"invalid","language":"de"}',
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  });

  expect(preferenceStorage(identity(1)).read()).toEqual({});
  expect(preferenceStorage('bad').read()).toEqual({});
  expect(() => preferenceStorage(identity(1)).write({ theme: 'dark' })).not.toThrow();
  expect(() => preferenceStorage(identity(1)).write({})).not.toThrow();
});
