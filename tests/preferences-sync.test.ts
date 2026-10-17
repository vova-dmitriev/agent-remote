import { expect, it } from 'vitest';
import { PreferenceSync } from '../apps/mini-app/src/shared/lib/preferences/sync.js';
import type { AccountPreferences, PreferencePatch } from '../packages/protocol/src/index.js';

const defaults: AccountPreferences = { language: 'ru', theme: 'auto' };

function setup(initial: PreferencePatch = {}) {
  let stored = initial;
  let visible = defaults;
  let error = '';

  const writes: {
    patch: PreferencePatch;
    resolve: (value: AccountPreferences) => void;
    reject: (error: Error) => void;
  }[] = [];

  const sync = new PreferenceSync({
    read: () => stored,
    write: (value) => {
      stored = value;
    },
    apply: (value) => {
      visible = { language: value.language ?? visible.language, theme: value.theme ?? visible.theme };
    },
    save: (patch) => new Promise((resolve, reject) => writes.push({ patch, resolve, reject })),
    error: (value) => {
      error = value;
    },
  });

  return { sync, writes, stored: () => stored, visible: () => visible, error: () => error };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

it('does not push browser defaults on hydration and restores explicit server choices', () => {
  const fixture = setup();

  fixture.sync.setOnline(true);
  fixture.sync.hydrate({ language: 'en', theme: 'dark' });
  expect(fixture.visible()).toEqual({ language: 'en', theme: 'dark' });
  expect(fixture.writes).toHaveLength(0);
});

it('preserves a choice made while loading and serializes newer writes', async () => {
  const fixture = setup();

  fixture.sync.change({ theme: 'light' });
  fixture.sync.setOnline(true);
  fixture.sync.hydrate({ language: 'en', theme: 'dark' });
  expect(fixture.visible()).toEqual({ language: 'en', theme: 'light' });
  expect(fixture.writes[0]!.patch).toEqual({ theme: 'light' });
  fixture.sync.change({ theme: 'dark', language: 'ru' });
  expect(fixture.writes).toHaveLength(1);
  fixture.writes[0]!.resolve({ language: 'en', theme: 'light' });
  await settle();
  expect(fixture.writes[1]!.patch).toEqual({ theme: 'dark', language: 'ru' });
  fixture.writes[1]!.resolve({ language: 'ru', theme: 'dark' });
  await settle();
  expect(fixture.stored()).toEqual({});
});

it('retains offline and failed choices, reports failure, and retries after reconnect', async () => {
  const fixture = setup({ language: 'en' });

  fixture.sync.hydrate({ language: 'ru', theme: null });
  expect(fixture.visible()).toEqual({ language: 'en', theme: 'auto' });
  expect(fixture.writes).toHaveLength(0);
  fixture.sync.setOnline(true);
  fixture.writes[0]!.reject(new Error('offline'));
  await settle();
  expect(fixture.error()).toBe('PREFERENCES_SAVE_FAILED');
  expect(fixture.stored()).toEqual({ language: 'en' });
  fixture.sync.setOnline(false);
  fixture.sync.setOnline(true);
  fixture.writes[1]!.resolve({ language: 'en', theme: null });
  await settle();
  expect(fixture.error()).toBe('');
  expect(fixture.stored()).toEqual({});
});

it('ignores late hydration and write completion after logout or an account change', async () => {
  const fixture = setup();

  fixture.sync.setOnline(true);
  fixture.sync.hydrate({ language: 'ru', theme: null });
  fixture.sync.change({ theme: 'dark' });
  fixture.sync.close();
  fixture.sync.hydrate({ language: 'en', theme: 'light' });
  fixture.writes[0]!.resolve({ language: 'ru', theme: 'dark' });
  await settle();
  expect(fixture.visible()).toEqual(defaults);
  expect(fixture.stored()).toEqual({ theme: 'dark' });
});

it('restores pending choices immediately while hydration is unavailable without saving defaults', () => {
  const fixture = setup({ language: 'en', theme: 'dark' });

  expect(fixture.visible()).toEqual({ language: 'en', theme: 'dark' });
  fixture.sync.setOnline(true);
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.stored()).toEqual({ language: 'en', theme: 'dark' });
});
