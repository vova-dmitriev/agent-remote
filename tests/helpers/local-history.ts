import { expect } from 'vitest';
import {
  HistoryDirection,
  LOCAL_LIMITS,
  LocalKind,
  LocalOperation,
  MessageRole,
  type EventEnvelope,
  type HistoryMessage,
} from '../../packages/protocol/src/index.js';
import { fragmentValue } from '../../packages/transport/src/native/fragments.js';
import { localFixture } from './local-runtime.js';

const fixtures: ReturnType<typeof localFixture>[] = [];

export async function closeHistoryFixtures() {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
  }
}

export function setup() {
  const fixture = localFixture();

  fixtures.push(fixture);

  return fixture;
}

export interface Page {
  events: EventEnvelope[];
  before: string | null;
  after: string | null;
}

export const ids = (page: Pick<Page, 'events'>) =>
  page.events.map((event) => (event.payload as HistoryMessage).id);

export function assertFits(page: Page) {
  const response = {
    kind: LocalKind.Result,
    requestId: '\0'.repeat(512),
    ok: true,
    data: page,
  };

  expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(LOCAL_LIMITS.logicalBytes);
  expect(() => fragmentValue(response, 'synthetic-history')).not.toThrow();
}

export function nativeSetup() {
  const fixture = setup();

  const messages: HistoryMessage[] = Array.from({ length: 100 }, (_, i) => ({
    id: `message-${i}`,
    historyCursor: `position:${i}`,
    role: MessageRole.Assistant,
    text: 'x\n'.repeat(32_768),
    occurredAt: 1000 + i,
  }));

  fixture.controller.options.history = async (request) => {
    let start = 0;
    let end = messages.length;

    if (request.direction === HistoryDirection.Before) {
      end = Number(request.anchor);
    }

    if (request.direction === HistoryDirection.After) {
      start = Number(request.anchor);
    }

    return {
      messages: messages.slice(start, end),
      before: start ? String(start) : null,
      after: end < messages.length ? String(end) : null,
    };
  };

  const read = async (direction: HistoryDirection, anchor?: string) =>
    fixture.controller.execute(fixture.principal, {
      operation: LocalOperation.History,
      sessionId: fixture.session.id,
      generation: fixture.session.generation,
      direction,
      ...(anchor ? { anchor } : {}),
    }) as Promise<Page>;

  return { fixture, messages, read };
}
