import { it, expect } from 'vitest';
import { Limiter } from '@server/auth/security.js';

it('does not retain a new client key after rejecting a full rate-limit table', () => {
  const limiter = new Limiter();

  for (let i = 0; i < 10000; i++) {
    limiter.take('client-' + i, 10, 1000);
  }

  for (let i = 0; i < 50; i++) {
    expect(() => limiter.take('excess-' + i, 10, 1000)).toThrow('RATE_LIMITED');
  }

  expect((Reflect.get(limiter, 'buckets') as Map<string, unknown>).size).toBeLessThanOrEqual(10000);
  expect(() => limiter.take('new-after-expiry', 10, 62000)).not.toThrow();
});
