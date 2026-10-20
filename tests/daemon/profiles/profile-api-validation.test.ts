import { writeFileSync } from 'node:fs';
import { HttpStatus } from '@protocol';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { verifyCodexApiCredential } from '../../../apps/daemon/src/profiles/api/codex.js';
import { profileRegistryFixture } from './fixtures/registry.fixture.js';

const secret = 'synthetic-protected-models-key';

function fixture() {
  const { directory } = profileRegistryFixture();

  writeFileSync(join(directory, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: secret }), { mode: 0o600 });

  return directory;
}

it('authenticates the selected private key against a fixed protected endpoint without inference', async () => {
  const fetcher = vi.fn(async () => Response.json({ data: [{ id: 'synthetic-model' }] }));
  const result = await verifyCodexApiCredential(fixture(), fetcher);

  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://api.openai.com/v1/models',
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${secret}` },
    }),
  );

  expect(result.models).toEqual(['synthetic-model']);
  expect(result.accountRef).toMatch(/^codex-key:[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain(secret);
});

it.each([401, 403])(
  'rejects an unverified API key at HTTP %i without leaking provider errors',
  async (status) => {
    await expect(
      verifyCodexApiCredential(fixture(), async () => new Response(secret, { status })),
    ).rejects.toThrow(/^PROFILE_NOT_READY$/);
  },
);

it('does not classify an ordinary 429 as exhausted quota or accept a cached native account', async () => {
  await expect(
    verifyCodexApiCredential(
      fixture(),
      async () => new Response(secret, { status: HttpStatus.TooManyRequests }),
    ),
  ).rejects.toThrow(/^RATE_LIMITED$/);
});

it('redacts transport failures and cancels an oversized streamed catalog', async () => {
  await expect(
    verifyCodexApiCredential(fixture(), async () => {
      throw new Error(secret);
    }),
  ).rejects.toThrow(/^NETWORK_UNAVAILABLE$/);

  const cancel = vi.fn();

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
    },
    cancel,
  });

  await expect(verifyCodexApiCredential(fixture(), async () => new Response(body))).rejects.toThrow(
    /^CODEX_PROTOCOL_ERROR$/,
  );

  expect(cancel).toHaveBeenCalledOnce();
});

it('detects a key replacement during protected discovery', async () => {
  const directory = fixture();

  await expect(
    verifyCodexApiCredential(directory, async () => {
      writeFileSync(
        join(directory, 'auth.json'),
        JSON.stringify({ OPENAI_API_KEY: 'changed-synthetic-key' }),
      );

      return Response.json({ data: [{ id: 'synthetic-model' }] });
    }),
  ).rejects.toThrow(/^PROFILE_MISMATCH$/);
});

it('refuses mixed credentials and malformed model evidence before readiness', async () => {
  const directory = fixture();
  const fetcher = vi.fn(async () => Response.json({ data: [{ id: '' }] }));

  await expect(verifyCodexApiCredential(directory, fetcher)).rejects.toThrow(/^CODEX_PROTOCOL_ERROR$/);

  writeFileSync(
    join(directory, 'auth.json'),
    JSON.stringify({ OPENAI_API_KEY: secret, tokens: { account_id: 'mixed' } }),
  );

  fetcher.mockClear();
  await expect(verifyCodexApiCredential(directory, fetcher)).rejects.toThrow(/^PROFILE_MISMATCH$/);
  expect(fetcher).not.toHaveBeenCalled();
});
