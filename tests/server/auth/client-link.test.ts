import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

const EXTENSION = 'chrome-extension://' + 'a'.repeat(32);
const json = { 'content-type': 'application/json' };

it('links a client once by a short code and renews its access with the credential it keeps', async () => {
  const f = await attachmentRelayFixture();

  try {
    const issued = await fetch(f.origin + '/auth/link-code', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + f.token },
    });

    const { code } = (await issued.json()) as { code: string };

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);
    expect((await fetch(f.origin + '/auth/link-code', { method: 'POST' })).status).toBe(401);

    // Typed by hand: case and a dash in the middle do not matter.
    const typed = code.slice(0, 4).toLowerCase() + '-' + code.slice(4);

    const link = await fetch(f.origin + '/auth/link', {
      method: 'POST',
      headers: { ...json, origin: EXTENSION },
      body: JSON.stringify({ code: typed }),
    });

    expect(link.headers.get('access-control-allow-origin')).toBe(EXTENSION);
    expect(link.headers.get('access-control-allow-credentials')).toBeNull();
    const linked = (await link.json()) as { token: string; refresh: string };

    expect((await f.relay.auth.authenticate(linked.token)).userId).toBe(f.principal.userId);

    expect(
      (
        await fetch(f.origin + '/auth/link', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ code }),
        })
      ).status,
    ).toBe(401);

    // No cookie and a foreign origin: the credential in the body renews access.
    const renewed = await fetch(f.origin + '/auth/refresh', {
      method: 'POST',
      headers: { ...json, origin: EXTENSION },
      body: JSON.stringify({ refresh: linked.refresh }),
    });

    const fresh = (await renewed.json()) as { token: string };

    expect((await f.relay.auth.authenticate(fresh.token)).userId).toBe(f.principal.userId);

    // Logout revokes the link's credential.
    await fetch(f.origin + '/auth/logout', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + fresh.token },
    });

    expect(
      (
        await fetch(f.origin + '/auth/refresh', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ refresh: linked.refresh }),
        })
      ).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});

it('answers an extension preflight and lets an extension, but no other site, open the app socket', async () => {
  const f = await attachmentRelayFixture();

  try {
    const preflight = await fetch(f.origin + '/sessions/any/events', {
      method: 'OPTIONS',
      headers: {
        origin: EXTENSION,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');

    const open = (origin: string) =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket(f.origin.replace('http', 'ws') + '/ws/app', { origin });

        socket.on('open', () => {
          socket.close();
          resolve(true);
        });

        socket.on('error', () => resolve(false));
      });

    expect(await open(EXTENSION)).toBe(true);
    expect(await open('https://foreign.invalid')).toBe(false);
  } finally {
    await f.close();
  }
});
