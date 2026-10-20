import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendFile, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexModelReader } from '../../../apps/daemon/src/codex/history/model-reader.js';

let home: string, path: string;
const metadata = (id: string) => JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n';
const context = (model: string) => JSON.stringify({ type: 'turn_context', payload: { model } }) + '\n';

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codex-model-reader-'));
  await mkdir(join(home, 'sessions'));
  path = join(home, 'sessions', 'thread.jsonl');
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it('requires exact thread identity and ignores models in messages or unrelated metadata', async () => {
  await writeFile(path, metadata('foreign') + context('foreign-model'));
  const source = new CodexModelReader(path, 'exact', home);

  expect(await source.read()).toBeUndefined();

  await writeFile(
    path,
    metadata('exact') + JSON.stringify({ type: 'response_item', payload: { model: 'message-model' } }) + '\n',
  );

  expect(await source.read()).toBeUndefined();
  await appendFile(path, context('gpt-exact'));
  expect(await source.read()).toBe('gpt-exact');
  expect(await source.read()).toBeUndefined();
});

it('rejects paths and symlinks outside the configured native sessions root', async () => {
  const outside = join(home, 'other.jsonl');

  await writeFile(outside, metadata('exact') + context('outside-model'));
  await symlink(outside, path);
  expect(await new CodexModelReader(outside, 'exact', home).read()).toBeUndefined();
  expect(await new CodexModelReader(path, 'exact', home).read()).toBeUndefined();
});

it('finds the latest complete turn context in a bounded tail and ignores invalid models', async () => {
  await writeFile(
    path,
    metadata('exact') + context('gpt-old') + 'x'.repeat(300_000) + '\n' + context('gpt-current'),
  );

  const source = new CodexModelReader(path, 'exact', home);

  expect(await source.read()).toBe('gpt-current');
  await appendFile(path, context('x'.repeat(257)) + context('gpt-partial').trimEnd());
  expect(await source.read()).toBeUndefined();
  await appendFile(path, '\n');
  expect(await source.read()).toBe('gpt-partial');
});

it('does not replay an old context after unrelated appends but accepts a distinct new context with the same model', async () => {
  await writeFile(path, metadata('exact') + context('gpt-previous'));
  const source = new CodexModelReader(path, 'exact', home);

  expect(await source.read()).toBe('gpt-previous');
  await appendFile(path, JSON.stringify({ type: 'response_item', payload: { type: 'message' } }) + '\n');
  expect(await source.read()).toBeUndefined();
  await appendFile(path, context('gpt-previous'));
  expect(await source.read()).toBe('gpt-previous');
});

it('keeps context identity stable when the bounded tail starts inside multibyte UTF-8 content', async () => {
  const large = JSON.stringify({ type: 'response_item', payload: { text: '😀'.repeat(80_000) } }) + '\n';

  await writeFile(path, metadata('exact') + large + context('gpt-before-notification'));
  const source = new CodexModelReader(path, 'exact', home);

  expect(await source.read()).toBe('gpt-before-notification');

  for (let index = 0; index < 4; index++) {
    await appendFile(path, '\n');
    expect(await source.read()).toBeUndefined();
  }
});
