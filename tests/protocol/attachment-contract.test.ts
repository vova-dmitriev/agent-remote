import { expect, it } from 'vitest';
import { clientCommandSchema, historySchema } from '@protocol';

const attachment = {
  id: 'file-one',
  name: 'photo.png',
  mimeType: 'image/png',
  byteLength: 100,
  sha256: 'a'.repeat(64),
  kind: 'image',
};

const base = {
  commandId: 'command',
  sessionId: 'session',
  generation: 'generation',
  target: { kind: 'codex-cli', deviceId: 'device', connectorId: 'connector', threadId: 'thread' },
};

it('accepts media-only prompts and history without exposing a filesystem path', () => {
  expect(
    clientCommandSchema.safeParse({
      ...base,
      action: { type: 'prompt', text: '', attachments: [attachment] },
    }).success,
  ).toBe(true);

  expect(
    historySchema.safeParse({
      id: 'message',
      role: 'user',
      text: '',
      occurredAt: 1,
      attachments: [attachment],
    }).success,
  ).toBe(true);

  expect(
    clientCommandSchema.safeParse({
      ...base,
      action: { type: 'prompt', text: '', attachments: [{ ...attachment, path: '/private/secret' }] },
    }).success,
  ).toBe(false);
});

it('rejects empty/oversized/duplicate attachment prompts and invalid digest metadata', () => {
  const parse = (attachments: unknown[], text = '') =>
    clientCommandSchema.safeParse({ ...base, action: { type: 'prompt', text, attachments } }).success;

  expect(parse([])).toBe(false);
  expect(parse([attachment, attachment])).toBe(false);
  expect(parse([{ ...attachment, byteLength: 10 * 1024 * 1024 + 1 }])).toBe(false);
  expect(parse([{ ...attachment, sha256: 'untrusted' }])).toBe(false);
  expect(parse(Array.from({ length: 6 }, (_, i) => ({ ...attachment, id: 'file-' + i })))).toBe(false);

  expect(
    parse(
      Array.from({ length: 3 }, (_, i) => ({ ...attachment, id: 'file-' + i, byteLength: 10 * 1024 * 1024 })),
    ),
  ).toBe(false);

  expect(parse([attachment], '\u001b[2J')).toBe(false);
});
