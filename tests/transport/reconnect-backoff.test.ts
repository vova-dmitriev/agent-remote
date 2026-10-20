import { expect, it } from 'vitest';
import { ReconnectBackoff } from '@transport/reconnect-backoff.js';

const POLICY = { BaseMs: 1_000, MaxMs: 30_000, StableMs: 10_000 } as const;
const TOP = () => 0.999_999;

it('caps the delay and starts again from the base after a reset', () => {
  const backoff = new ReconnectBackoff(POLICY, TOP);
  const delays = Array.from({ length: 12 }, () => backoff.next(0));

  expect(delays.slice(0, 4)).toEqual([999, 1_999, 3_999, 7_999]);
  expect(Math.max(...delays)).toBeLessThan(POLICY.MaxMs);
  expect(delays.at(-1)).toBe(POLICY.MaxMs - 1);

  backoff.reset();
  expect(backoff.next(0)).toBe(POLICY.BaseMs - 1);
});

it('never waits less than half the ceiling', () => {
  const backoff = new ReconnectBackoff(POLICY, () => 0);

  expect([backoff.next(0), backoff.next(0)]).toEqual([POLICY.BaseMs / 2, POLICY.BaseMs]);
});

it('starts again from the base only after a connection stayed authenticated for the stable minimum', () => {
  const backoff = new ReconnectBackoff(POLICY, TOP);

  backoff.next(0);
  backoff.authenticated(1_000);
  expect(backoff.next(1_000 + POLICY.StableMs - 1)).toBe(POLICY.BaseMs * 2 - 1);

  backoff.authenticated(20_000);
  expect(backoff.next(20_000 + POLICY.StableMs)).toBe(POLICY.BaseMs - 1);
});
