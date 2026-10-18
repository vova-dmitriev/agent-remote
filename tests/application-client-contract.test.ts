import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { RelayOperations } from '../apps/mini-app/src/shared/api/relay-operations.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('maps typed application operations to encoded relay routes without exposing URLs to features', async () => {
  const seen: { method: string; path: string; body: unknown }[] = [];

  const server = createServer(async (request, response) => {
    let body = '';

    for await (const chunk of request) {
      body += String(chunk);
    }

    seen.push({ method: request.method!, path: request.url!, body: body ? JSON.parse(body) : null });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/preferences' ? { language: 'en', theme: 'dark' } : {}));
  }).listen(0, '127.0.0.1');

  servers.push(server);
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('missing test listener');
  }

  const origin = `http://127.0.0.1:${address.port}`;

  class Client extends RelayOperations {
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      return (await fetch(origin + path, options)).json() as Promise<T>;
    }
  }

  const client = new Client();

  expect(await client.getPreferences()).toEqual({ language: 'en', theme: 'dark' });
  await client.savePreferences({ language: 'en' });
  await client.renameSession('a/b', 'Title', 'generation-1');
  await client.claimDevice('pair-code');
  await client.revokeDevice('device/a');

  expect(seen).toEqual([
    { method: 'GET', path: '/preferences', body: null },
    { method: 'PATCH', path: '/preferences', body: { language: 'en' } },
    { method: 'PATCH', path: '/sessions/a%2Fb', body: { title: 'Title', generation: 'generation-1' } },
    { method: 'POST', path: '/pair/claim', body: { code: 'pair-code' } },
    { method: 'DELETE', path: '/devices/device%2Fa', body: null },
  ]);
});
