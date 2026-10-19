import { afterEach, expect, it, vi } from 'vitest';
import { HttpStatus } from '@protocol';
import { AppTransport } from '../apps/mini-app/src/shared/api/transport.js';

const transport = () =>
  new AppTransport('synthetic-init', { onFrame() {}, onConnection() {} }, 'https://synthetic.invalid');

afterEach(() => vi.unstubAllGlobals());

it.each([
  [401, 'UNAUTHORIZED'],
  [403, 'ACCESS_DENIED'],
  [404, 'NOT_FOUND'],
  [408, 'REQUEST_TIMEOUT'],
  [429, 'RATE_LIMITED'],
  [503, 'SERVICE_UNAVAILABLE'],
])('keeps an actionable machine code for HTTP %i without a JSON error', async (status, code) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('synthetic upstream detail', { status })));
  await expect(transport().devices()).rejects.toMatchObject({ message: code, status });
});

it.each([
  [new TypeError('synthetic network details'), 'NETWORK_UNAVAILABLE'],
  [new DOMException('synthetic timeout detail', 'AbortError'), 'REQUEST_TIMEOUT'],
  [new DOMException('synthetic timeout detail', 'TimeoutError'), 'REQUEST_TIMEOUT'],
])('normalizes a fetch failure while retaining machine state', async (error, code) => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
  await expect(transport().devices()).rejects.toThrow(code);
  const onConnection = vi.fn();

  const client = new AppTransport(
    'synthetic-init',
    { onFrame() {}, onConnection },
    'https://synthetic.invalid',
  );

  await expect(client.start()).rejects.toThrow(code);
  expect(onConnection.mock.calls).toEqual([['connecting'], ['offline']]);
});

it('preserves server error codes and HTTP status for command retry decisions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ code: 'STALE_SESSION' }, { status: HttpStatus.Conflict })),
  );

  await expect(transport().devices()).rejects.toMatchObject({
    message: 'STALE_SESSION',
    status: HttpStatus.Conflict,
  });
});

it('handles malformed error payloads without showing serialized server data', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: { token: 'synthetic-private' } }, { status: HttpStatus.ServiceUnavailable }),
      ),
  );

  await expect(transport().devices()).rejects.toMatchObject({
    message: 'SERVICE_UNAVAILABLE',
    status: HttpStatus.ServiceUnavailable,
  });
});

it.each([
  [401, 'TELEGRAM_AUTH_FAILED', 'expired'],
  [403, 'TELEGRAM_AUTH_FAILED', 'expired'],
  [429, 'RATE_LIMITED', 'offline'],
  [503, 'SERVICE_UNAVAILABLE', 'offline'],
])(
  'distinguishes authentication from service errors on sign-in HTTP %i',
  async (status, code, connection) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('synthetic failure', { status: Number(status) })),
    );

    const onConnection = vi.fn();

    const client = new AppTransport(
      'synthetic-init',
      { onFrame() {}, onConnection },
      'https://synthetic.invalid',
    );

    await expect(client.start()).rejects.toThrow(String(code));
    expect(onConnection).toHaveBeenLastCalledWith(connection);
  },
);
