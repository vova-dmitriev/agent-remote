import { afterEach, expect, it } from 'vitest';
import {
  ErrorCode,
  EventType,
  HistoryDirection,
  LOCAL_LIMITS,
  LocalOperation,
  MessageRole,
  type HistoryMessage,
} from '@protocol';
import {
  assertFits,
  closeHistoryFixtures,
  ids,
  nativeSetup,
  setup,
  type Page,
} from '../../helpers/local/local-history.js';

afterEach(closeHistoryFixtures);

it('splits latest native history by encoded bytes and traverses before without skipping complete messages', async () => {
  const { messages, read } = nativeSetup();
  const latest = await read(HistoryDirection.Latest);

  assertFits(latest);
  expect(latest.events.length).toBeLessThan(messages.length);
  expect(ids(latest).at(-1)).toBe('message-99');
  const older = await read(HistoryDirection.Before, latest.before!);

  assertFits(older);
  expect([...ids(older), ...ids(latest)]).toEqual(messages.map((message) => message.id));
  expect((latest.events[0]!.payload as HistoryMessage).text).toBe(messages[0]!.text);
});

it('splits native after pages at the first omitted row, whose native cursor is inclusive', async () => {
  const { messages, read } = nativeSetup();
  const first = await read(HistoryDirection.After, '0');

  assertFits(first);
  expect(ids(first)[0]).toBe('message-0');
  const rest = await read(HistoryDirection.After, first.after!);

  assertFits(rest);
  expect([...ids(first), ...ids(rest)]).toEqual(messages.map((message) => message.id));
});

it('keeps the requested middle bookmark inside a bounded native around page with resumable edges', async () => {
  const { messages, read } = nativeSetup();
  const middle = await read(HistoryDirection.Around, 'message-50');

  assertFits(middle);
  expect(ids(middle)).toContain('message-50');
  const before = middle.before ? await read(HistoryDirection.Before, middle.before) : { events: [] };
  const after = middle.after ? await read(HistoryDirection.After, middle.after) : { events: [] };

  expect([...ids(before), ...ids(middle), ...ids(after)]).toEqual(messages.map((message) => message.id));
});

it('keeps an exact cached bookmark even when all message timestamps are equal', async () => {
  const fixture = setup();

  for (let i = 0; i < 30; i++) {
    fixture.monitor.publish(fixture.session.id, EventType.Message, {
      id: `same-time-${i}`,
      role: MessageRole.Assistant,
      text: 'synthetic',
      occurredAt: 1000,
    });
  }

  const page = (await fixture.controller.execute(fixture.principal, {
    operation: LocalOperation.History,
    sessionId: fixture.session.id,
    generation: fixture.session.generation,
    direction: HistoryDirection.Around,
    anchor: 'same-time-0',
  })) as Page;

  expect(ids(page)).toContain('same-time-0');
});

it('bounds cached pages and keeps exclusive cache cursors accurate for both directions', async () => {
  const fixture = setup();

  for (let i = 0; i < 30; i++) {
    fixture.monitor.publish(fixture.session.id, EventType.Message, {
      id: `cache-${i}`,
      role: MessageRole.Assistant,
      text: '\0'.repeat(65_535) + 'x',
      occurredAt: 1000 + i,
    });
  }

  const read = async (direction: HistoryDirection, anchor?: string) =>
    fixture.controller.execute(fixture.principal, {
      operation: LocalOperation.History,
      sessionId: fixture.session.id,
      generation: fixture.session.generation,
      direction,
      ...(anchor ? { anchor } : {}),
    }) as Promise<Page>;

  const latest = await read(HistoryDirection.Latest);

  assertFits(latest);
  const before = await read(HistoryDirection.Before, latest.before!);

  assertFits(before);
  expect([...ids(before), ...ids(latest)]).toEqual(Array.from({ length: 30 }, (_, i) => `cache-${i}`));
  const after = await read(HistoryDirection.After, before.after!);

  assertFits(after);
  expect(ids(after)).toEqual(ids(latest));

  const middle = await read(HistoryDirection.Around, 'cache-15');

  assertFits(middle);
  expect(ids(middle)).toContain('cache-15');
  const older = await read(HistoryDirection.Before, middle.before!);
  const newer = await read(HistoryDirection.After, middle.after!);

  expect([...ids(older), ...ids(middle), ...ids(newer)]).toEqual(
    Array.from({ length: 30 }, (_, i) => `cache-${i}`),
  );
});

it('rejects a single oversized event explicitly instead of truncating its payload', async () => {
  const fixture = setup();

  fixture.monitor.publish(fixture.session.id, EventType.Message, {
    id: 'oversized',
    role: MessageRole.Assistant,
    text: 'x'.repeat(LOCAL_LIMITS.logicalBytes),
    occurredAt: 1,
  });

  await expect(
    fixture.controller.execute(fixture.principal, {
      operation: LocalOperation.History,
      sessionId: fixture.session.id,
      generation: fixture.session.generation,
      direction: HistoryDirection.Latest,
    }),
  ).rejects.toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
});
