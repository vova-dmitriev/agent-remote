import { expect, it } from 'vitest';
import { connectMac, ensureMacConnected, type PairingDependencies } from '@daemon/cli/pairing/connect.js';

const config = { relayUrl: 'http://127.0.0.1:3040', deviceId: 'existing', deviceToken: 'fixture' };

function harness() {
  const calls: Array<{ path: string; body: Record<string, string | boolean> }> = [],
    opened: string[] = [],
    saved: unknown[] = [],
    prompts: string[] = [];

  let now = 0;

  const deps: PairingDependencies = {
    request: async (_origin, path, body) => {
      calls.push({ path, body });

      if (path.endsWith('/start')) {
        return { expiresAt: 300000, botUsername: 'fixture_bot' };
      }

      if (path.endsWith('/status')) {
        return { claimId: 'claim', telegramId: '101', expiresAt: 300000 };
      }

      if (path.endsWith('/confirm')) {
        return body.approved ? { deviceId: 'new', token: 'synthetic-token' } : null;
      }

      return {};
    },
    open: async (url) => {
      opened.push(url);
    },
    confirm: async (id) => {
      prompts.push(id);

      return true;
    },
    save: async (value) => {
      saved.push(value);
    },
    secret: async () => 'synthetic-secret',
    load: async () => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    },
    random: (bytes) => (bytes === 16 ? 'a' : 'b').repeat(bytes * 2),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    write: () => {},
  };

  return { deps, calls, opened, saved, prompts };
}

it('opens a standard Telegram link containing only the short code and saves after local approval', async () => {
  const h = harness();

  expect(await connectMac({}, h.deps)).toBe(true);
  expect(h.opened).toEqual(['https://t.me/fixture_bot?start=pair_' + 'a'.repeat(32)]);
  expect(h.prompts).toEqual(['101']);

  expect(h.calls[0]!.body).toEqual({
    codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    proofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });

  expect(h.saved).toEqual([{ relayUrl: config.relayUrl, deviceId: 'new', deviceToken: 'synthetic-token' }]);
  expect(h.opened.join()).not.toContain('b'.repeat(64));
});

it('saves nothing after rejection and consumes the local pairing', async () => {
  const h = harness();

  h.deps.confirm = async () => false;
  expect(await connectMac({}, h.deps)).toBe(false);
  expect(h.saved).toEqual([]);
  expect(h.calls.at(-1)?.path).toBe('/device/pair/cancel');
});

it('expires without opening a late confirmation and cleans up the pairing', async () => {
  const h = harness();

  h.deps.request = async (_origin, path, body) => {
    h.calls.push({ path, body });

    return path.endsWith('/start') ? { expiresAt: 1 } : { claimId: null, telegramId: null, expiresAt: 1 };
  };

  await expect(connectMac({}, h.deps)).rejects.toThrow('PAIRING_EXPIRED');
  expect(h.prompts).toEqual([]);
  expect(h.saved).toEqual([]);
  expect(h.calls.at(-1)?.path).toBe('/device/pair/cancel');
});

it('aborts polling and cleans up with an independent cancellation request', async () => {
  const h = harness(),
    controller = new AbortController();

  h.deps.sleep = async () => {
    controller.abort();
  };

  const request = h.deps.request;

  h.deps.request = async (origin, path, body, signal) =>
    path.endsWith('/status')
      ? { claimId: null, telegramId: null, expiresAt: 300000 }
      : request(origin, path, body, signal);

  await expect(connectMac({ signal: controller.signal }, h.deps)).rejects.toThrow('PAIRING_CANCELLED');
  expect(h.saved).toEqual([]);
  expect(h.calls.at(-1)?.path).toBe('/device/pair/cancel');
});

it('preserves an already paired installation without generating or sending another code', async () => {
  const h = harness();

  h.deps.load = async () => config;
  expect(await ensureMacConnected({}, h.deps)).toBe(true);
  expect(h.calls).toEqual([]);
  expect(h.opened).toEqual([]);
  expect(h.saved).toEqual([]);
});

it('only starts automatic pairing for a missing local config', async () => {
  const h = harness();

  h.deps.load = async () => {
    throw new Error('INVALID_CONFIG');
  };

  await expect(ensureMacConnected({}, h.deps)).rejects.toThrow('INVALID_CONFIG');
  expect(h.calls).toEqual([]);
});

it('keeps manual code entry usable when opening Telegram fails', async () => {
  const h = harness(),
    output: string[] = [];

  h.deps.open = async () => {
    throw new Error('NO_BROWSER');
  };

  h.deps.write = (value) => {
    output.push(value);
  };

  expect(await connectMac({}, h.deps)).toBe(true);
  expect(output.join()).toContain('a'.repeat(32));
});

it('does not accept a confirmation that finishes after expiry', async () => {
  const h = harness();

  h.deps.confirm = async () => {
    await h.deps.sleep(300001, new AbortController().signal);

    return true;
  };

  await expect(connectMac({}, h.deps)).rejects.toThrow('PAIRING_EXPIRED');
  expect(h.saved).toEqual([]);
  expect(h.calls.some((call) => call.path.endsWith('/confirm'))).toBe(false);
});

it('cancels a native confirmation when the personal launcher closes', async () => {
  const h = harness(),
    controller = new AbortController();

  h.deps.confirm = async () => {
    controller.abort();

    return true;
  };

  await expect(connectMac({ signal: controller.signal }, h.deps)).rejects.toThrow('PAIRING_CANCELLED');
  expect(h.saved).toEqual([]);
  expect(h.calls.at(-1)?.path).toBe('/device/pair/cancel');
});

it('does not pair when connect is called with an existing config for another relay', async () => {
  const h = harness();

  h.deps.load = async () => ({ ...config, relayUrl: 'https://other.example' });
  expect(await ensureMacConnected({}, h.deps)).toBe(true);
  expect(h.calls).toEqual([]);
});

it('cleans up a failed relay poll without masking its error', async () => {
  const h = harness(),
    request = h.deps.request;

  h.deps.request = async (origin, path, body, signal) => {
    if (path.endsWith('/status')) {
      throw new Error('RELAY_503');
    }

    return request(origin, path, body, signal);
  };

  await expect(connectMac({}, h.deps)).rejects.toThrow('RELAY_503');
  expect(h.calls.at(-1)?.path).toBe('/device/pair/cancel');
});

it('retains manual pairing without opening Telegram', async () => {
  const h = harness();

  expect(await connectMac({ manual: true }, h.deps)).toBe(true);
  expect(h.opened).toEqual([]);
});

it('rejects malformed relay registration and cleans up the local proof', async () => {
  const h = harness(),
    request = h.deps.request;

  h.deps.request = async (origin, path, body, signal) => {
    if (path.endsWith('/start')) {
      h.calls.push({ path, body });

      return { expiresAt: 'forever' };
    }

    return request(origin, path, body, signal);
  };

  await expect(connectMac({}, h.deps)).rejects.toThrow('INVALID_PAIRING_RESPONSE');
  expect(h.saved).toEqual([]);
  expect(h.calls.at(-1)?.path).toBe('/device/pair/cancel');
});

it('rejects malformed confirmation credentials before writing config', async () => {
  const h = harness(),
    request = h.deps.request;

  h.deps.request = async (origin, path, body, signal) => {
    if (path.endsWith('/confirm')) {
      return { deviceId: 'fixture', token: '' };
    }

    return request(origin, path, body, signal);
  };

  await expect(connectMac({}, h.deps)).rejects.toThrow('INVALID_PAIRING_RESPONSE');
  expect(h.saved).toEqual([]);
});
