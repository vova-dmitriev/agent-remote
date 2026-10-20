import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const SOURCE_ROOTS = [
  'apps/server/src',
  'apps/daemon/src',
  'apps/desktop/src',
  'apps/mini-app/src',
  'apps/chrome-extension/src',
  'packages/protocol/src',
  'packages/transport/src',
];

/** Localized copy lives only in dictionaries: the Mini App's i18n and the bot's notification copy. */
const DICTIONARIES = ['apps/mini-app/src/shared/lib/i18n/', 'apps/server/src/notifications/copy/'];

const SOURCE = /\.(ts|tsx|mjs)$/;
const EXCLUDED = /\.(stories|test|spec)\.[a-z]+$/;
const CYRILLIC = /[А-Яа-яЁё]/;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : files(path);
    }

    return SOURCE.test(entry.name) && !EXCLUDED.test(entry.name) ? [path] : [];
  });
}

it('keeps user-facing text in dictionaries, not hard-coded in a language', () => {
  const offenders = SOURCE_ROOTS.flatMap(files)
    .filter((path) => !DICTIONARIES.some((dictionary) => path.startsWith(dictionary)))
    .flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (CYRILLIC.test(line) ? [`${path}:${index + 1}`] : [])),
    );

  expect(offenders).toEqual([]);
});
