import { describe, it, expect } from 'vitest';
import { CommandSubmission } from '../apps/mini-app/src/shared/api/commands.js';
import type { ClientCommand } from '@protocol';

const command: ClientCommand = {
  commandId: 'original',
  target: { kind: 'claude-code-cli', deviceId: 'd', connectorId: 'c', claudeSessionId: 's' },
  sessionId: 's',
  generation: 'g',
  action: { type: 'prompt', text: 'hello' },
};

describe('uncertain browser command recovery', () => {
  it('preserves a delivered result when an older HTTP acceptance arrives after the WebSocket receipt', async () => {
    const client = new CommandSubmission(async () => {
      client.observe({ commandId: 'original', status: 'dispatched' });

      return { commandId: 'original', status: 'accepted' };
    });

    expect(await client.send(command)).toEqual({ commandId: 'original', status: 'dispatched' });
    expect(client.observe({ commandId: 'original', status: 'accepted' }).status).toBe('dispatched');
    expect(client.observe({ commandId: 'another', status: 'accepted' }).status).toBe('accepted');
  });

  it('keeps the original command ID and queries status after response loss', async () => {
    let posts = 0,
      gets = 0;

    let recover = false;

    const client = new CommandSubmission(async (method, path, _body) => {
      if (method === 'POST') {
        posts++;
        throw new TypeError('network lost');
      }

      gets++;

      if (!recover) {
        throw new TypeError('still offline');
      }

      expect(path).toBe('/commands/original');

      return { commandId: 'original', status: 'dispatched' };
    });

    await expect(client.send(command)).rejects.toThrow('COMMAND_STATUS_UNKNOWN');
    recover = true;

    expect(await client.send({ ...command, commandId: 'accidental-new-id' })).toEqual({
      commandId: 'original',
      status: 'dispatched',
    });

    expect(posts).toBe(1);
    expect(gets).toBeGreaterThan(0);
  });

  it('retries only the same ID if status is not found after an interrupted submission', async () => {
    const bodies: ClientCommand[] = [];
    let online = false;

    const client = new CommandSubmission(async (method, _path, body) => {
      if (method === 'GET') {
        throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      }

      bodies.push(body!);

      if (!online) {
        throw new TypeError('network lost');
      }

      return { commandId: body!.commandId, status: 'accepted' };
    });

    await expect(client.send(command)).rejects.toThrow('COMMAND_STATUS_UNKNOWN');
    online = true;
    await client.send({ ...command, commandId: 'new' });
    expect(bodies.map((value) => value.commandId)).toEqual(['original', 'original']);
  });
});
