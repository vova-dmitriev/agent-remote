import { expect, it } from 'vitest';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';
import { BrowserSessions } from '../apps/server/src/auth/sessions/browser-sessions.js';
import { initData } from './helpers/telegram.js';

it('renews access using a server-side browser session and revokes all its access tokens on logout', async () => {
  const f = await attachmentRelayFixture();

  try {
    const browser = new BrowserSessions(f.database.db);
    const session = await browser.create(f.token);
    const refreshed = await browser.refresh(session.secret);

    expect(await f.relay.auth.authenticate(refreshed.token)).toEqual(f.principal);
    await expect(browser.refresh('0'.repeat(64))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await expect(browser.refresh(session.secret, session.expiresAt + 1)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    await f.relay.auth.logout(refreshed.token);
    await expect(browser.refresh(session.secret)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(f.relay.auth.authenticate(f.token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  } finally {
    await f.close();
  }
});

it('keeps the refresh credential out of JSON, rejects cross-origin refresh and accepts only its HttpOnly cookie', async () => {
  const f = await attachmentRelayFixture();

  try {
    const login = await fetch(f.origin + '/auth/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData('410001') }),
    });

    const cookie = login.headers.get('set-cookie')!;

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(Object.keys(await login.json())).toEqual(['token', 'expiresAt']);
    const headers = { cookie: cookie.split(';')[0]!, origin: 'http://localhost' };

    expect(
      (
        await fetch(f.origin + '/auth/refresh', {
          method: 'POST',
          headers: { ...headers, origin: 'https://foreign.invalid' },
        })
      ).status,
    ).toBe(403);

    expect(
      (await fetch(f.origin + '/auth/refresh', { method: 'POST', headers: { origin: 'http://localhost' } }))
        .status,
    ).toBe(401);

    expect((await fetch(f.origin + '/auth/refresh', { method: 'POST', headers })).status).toBe(200);

    expect(
      (
        await fetch(f.origin + '/auth/refresh', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ initData: initData('410002', Date.now() - 360000) }),
        })
      ).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});

it('logout with an expired access token still revokes the owned browser cookie', async () => {
  const f = await attachmentRelayFixture();

  try {
    const browser = new BrowserSessions(f.database.db),
      session = await browser.create(f.token);

    await f.database.db.pool.query('UPDATE auth_sessions SET expires_at=0');

    const response = await fetch(f.origin + '/auth/logout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + f.token,
        origin: 'http://localhost',
        cookie: 'agent_remote_refresh=' + session.secret,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    await expect(browser.refresh(session.secret)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  } finally {
    await f.close();
  }
});
