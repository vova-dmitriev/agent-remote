import { expect, it } from 'vitest';
import { HttpStatus } from '@protocol';
import { CommandSubmission } from '../../../apps/mini-app/src/entities/command/api/commands.js';
import type { ClientCommand, CommandResult } from '@protocol';

const prompt = (commandId: string, sessionId = 's'): ClientCommand => ({
  commandId,
  target: { kind: 'claude-code-cli', deviceId: 'd', connectorId: 'c', claudeSessionId: sessionId },
  sessionId,
  generation: 'g',
  action: { type: 'prompt', text: commandId },
});

it('isolates pending prompts by session and permits an independent interrupt', async () => {
  const posted: string[] = [];

  const client = new CommandSubmission(async (_method, _path, body) => {
    posted.push(body!.commandId);

    return { commandId: body!.commandId, status: 'accepted' };
  });

  await client.send(prompt('first'));
  await expect(client.send(prompt('blocked'))).rejects.toThrow('COMMAND_PENDING_STATUS');
  await client.send(prompt('other', 'other-session'));
  await client.send({ ...prompt('interrupt'), action: { type: 'interrupt' } });
  client.observe({ commandId: 'interrupt', status: 'dispatched' });
  await expect(client.send(prompt('still-blocked'))).rejects.toThrow('COMMAND_PENDING_STATUS');
  client.observe({ commandId: 'first', status: 'dispatched' });
  await client.send(prompt('next'));
  expect(posted).toEqual(['first', 'other', 'interrupt', 'next']);
});

it('allows another session while a POST is in flight without releasing its prompt lane', async () => {
  let finish!: (result: CommandResult) => void;

  const client = new CommandSubmission(async (_method, _path, body) => {
    if (body!.commandId === 'first') {
      return new Promise((resolve) => {
        finish = resolve;
      });
    }

    return { commandId: body!.commandId, status: 'dispatched' };
  });

  const first = client.send(prompt('first'));

  await expect(client.send(prompt('second'))).rejects.toThrow('COMMAND_PENDING_STATUS');
  expect((await client.send(prompt('other', 'other-session'))).status).toBe('dispatched');
  finish({ commandId: 'first', status: 'accepted' });
  await first;
  await expect(client.send(prompt('third'))).rejects.toThrow('COMMAND_PENDING_STATUS');
});

it('checks exact pending IDs without reposting on missing status and retries only the selected ID', async () => {
  const calls: string[] = [];

  const client = new CommandSubmission(async (method, path, body) => {
    calls.push(`${method} ${method === 'POST' ? body!.commandId : path}`);

    if (method === 'GET') {
      throw Object.assign(new Error('NOT_FOUND'), { status: HttpStatus.NotFound });
    }

    return { commandId: body!.commandId, status: 'accepted' };
  });

  await client.send(prompt('first'));
  await client.send(prompt('other', 'other-session'));
  await expect(client.retryPending()).rejects.toThrow('PENDING_COMMAND_ID_REQUIRED');
  await expect(client.checkPending('first')).rejects.toThrow('COMMAND_STATUS_UNKNOWN');
  expect(calls).toEqual(['POST first', 'POST other', 'GET /commands/first']);
  await client.retryPending('other');
  expect(calls.slice(-2)).toEqual(['GET /commands/other', 'POST other']);
});

it('keeps a terminal receipt monotonic when an older status check completes later', async () => {
  let finish!: (result: CommandResult) => void;

  const client = new CommandSubmission(async (method, _path, body) => {
    if (method === 'GET') {
      return new Promise((resolve) => {
        finish = resolve;
      });
    }

    return { commandId: body!.commandId, status: 'unknown' };
  });

  await client.send(prompt('first'));
  const checking = client.checkPending('first');

  client.observe({ commandId: 'first', status: 'dispatched' });
  finish({ commandId: 'first', status: 'accepted' });
  expect((await checking).status).toBe('dispatched');
  expect((await client.checkPending('first')).status).toBe('dispatched');
});

it('does not let an uncertain control block prompts or overwrite another command identity', async () => {
  const posted: string[] = [];

  const client = new CommandSubmission(async (_method, _path, body) => {
    posted.push(body!.commandId);

    return { commandId: body!.commandId, status: 'unknown' };
  });

  await client.send({ ...prompt('control'), action: { type: 'interrupt' } });
  await client.send(prompt('first'));
  await expect(client.send(prompt('first', 'different-session'))).rejects.toThrow('COMMAND_PENDING_STATUS');
  client.observe({ commandId: 'control', status: 'dispatched' });

  expect((await client.send({ ...prompt('control'), action: { type: 'interrupt' } })).status).toBe(
    'dispatched',
  );

  expect(posted).toEqual(['control', 'first']);
});

it('does not let an obsolete binding block a replacement generation', async () => {
  const posted: string[] = [];

  const client = new CommandSubmission(async (_method, _path, body) => {
    posted.push(body!.commandId);

    return { commandId: body!.commandId, status: 'unknown' };
  });

  await client.send(prompt('old'));
  await client.send({ ...prompt('replacement'), generation: 'new-generation' });
  expect(posted).toEqual(['old', 'replacement']);
});
