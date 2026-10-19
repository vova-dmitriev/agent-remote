import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { CodexRpcClient } from '../apps/daemon/src/codex/rpc/rpc-client.js';

function fixture(options: { timeoutMs?: number; maxFrameBytes?: number } = {}) {
  const input = new PassThrough(),
    output = new PassThrough();

  const sent: Record<string, unknown>[] = [];

  input.on('data', (chunk) => sent.push(JSON.parse(String(chunk))));
  const client = new CodexRpcClient({ input, output, ...options });

  return { client, sent, incoming: (frame: unknown) => output.write(JSON.stringify(frame) + '\n'), output };
}

describe('Codex bounded JSON-RPC transport', () => {
  it('initializes exactly once and correlates out of order responses, notifications and requests', async () => {
    const f = fixture();

    const first = f.client.initialize(),
      duplicate = f.client.initialize();

    f.incoming({ id: f.sent[0]!.id, result: { userAgent: 'codex/fixture' } });
    await Promise.all([first, duplicate]);
    expect(f.sent.map((frame) => frame.method)).toEqual(['initialize', 'initialized']);
    const one = f.client.request('thread/read', { threadId: 'one' });
    const two = f.client.request('thread/read', { threadId: 'two' });

    f.incoming({ id: f.sent[3]!.id, result: 'two' });
    f.incoming({ id: f.sent[2]!.id, result: 'one' });
    expect(await one).toBe('one');
    expect(await two).toBe('two');

    const notifications: unknown[] = [],
      requests: unknown[] = [];

    f.client.on('notification', (frame) => notifications.push(frame));
    f.client.on('request', (frame) => requests.push(frame));
    f.incoming({ method: 'turn/completed', params: { threadId: 'one' } });
    f.incoming({ method: 'item/fileChange/requestApproval', id: 'server-1', params: {} });
    expect(notifications).toHaveLength(1);
    expect(requests).toHaveLength(1);
    f.client.respond('server-1', { decision: 'decline' });
    expect(f.sent.at(-1)).toEqual({ id: 'server-1', result: { decision: 'decline' } });
    await f.client.close();
  });

  it('buffers UTF-8 fragments and ignores unknown IDs without consuming another request', async () => {
    const f = fixture();
    const pending = f.client.request('thread/read', {});

    f.incoming({ id: 'unknown', result: 'wrong' });
    const bytes = Buffer.from(JSON.stringify({ id: f.sent[0]!.id, result: 'Привет' }) + '\n');

    for (const byte of bytes) {
      f.output.write(Buffer.from([byte]));
    }

    expect(await pending).toBe('Привет');
    await f.client.close();
  });

  it('marks a mutating request uncertain after write loss and never retries it', async () => {
    const f = fixture({ timeoutMs: 10 });
    const pending = f.client.request('turn/start', { threadId: 'exact' });

    await expect(pending).rejects.toThrow('UNKNOWN_AFTER_WRITE');
    expect(f.sent).toHaveLength(1);
    await f.client.close();
  });

  it('rejects malformed and oversized frames and drains pending reads on close', async () => {
    const malformed = fixture();
    const read = malformed.client.request('thread/read', {});

    malformed.output.write('{bad}\n');
    await expect(read).rejects.toThrow('CODEX_PROTOCOL_ERROR');
    const large = fixture({ maxFrameBytes: 64 });
    const pending = large.client.request('thread/read', {});

    large.output.write('x'.repeat(65));
    await expect(pending).rejects.toThrow('CODEX_PROTOCOL_ERROR');
    const closed = fixture();
    const last = closed.client.request('thread/read', {});

    await closed.client.close();
    await expect(last).rejects.toThrow('CODEX_DISCONNECTED');
  });
});

it('receives a native image history frame larger than four MiB without disconnecting', async () => {
  const f = fixture();
  const image = Buffer.alloc(4 * 1024 * 1024, 3).toString('base64');
  const seen: unknown[] = [];

  f.client.on('notification', (frame) => seen.push(frame));

  f.incoming({
    method: 'item/completed',
    params: {
      threadId: 'synthetic',
      turnId: 't',
      item: {
        id: 'image',
        type: 'userMessage',
        content: [{ type: 'image', url: `data:image/png;base64,${image}` }],
      },
    },
  });

  expect(seen).toHaveLength(1);
  const pending = f.client.request('thread/read', { threadId: 'synthetic' });

  f.incoming({ id: f.sent.at(-1)!.id, result: 'still-connected' });
  expect(await pending).toBe('still-connected');
  await f.client.close();
});

it.each(['account/read', 'model/list', 'account/rateLimits/read', 'config/read'])(
  'reports a %s timeout as a read failure rather than uncertain delivery',
  async (method) => {
    const f = fixture({ timeoutMs: 10 });

    try {
      await expect(f.client.request(method, {})).rejects.toThrow('CODEX_TIMEOUT');
    } finally {
      await f.client.close();
    }
  },
);
