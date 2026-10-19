import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';
import type { AppSnapshot, PendingUserInput, Session, UserInputAnswers } from '@protocol';

let fixture: Awaited<ReturnType<typeof attachmentRelayFixture>>;
let session: Session;
let pending: PendingUserInput;

beforeEach(async () => {
  fixture = await attachmentRelayFixture();

  session = {
    ...fixture.session,
    status: 'running',
    capabilities: { ...fixture.session.capabilities, userInput: true },
  };

  pending = {
    requestId: 'request',
    sessionId: session.id,
    generation: session.generation,
    turnId: 'turn',
    itemId: 'item',
    expiresAt: Date.now() + 30000,
    isBlocking: false,
    questions: [
      {
        id: 'style',
        header: '',
        question: 'Pick a style',
        isOther: true,
        isSecret: false,
        options: [{ label: 'Dark', description: '' }],
      },
    ],
  };

  await save();
});

afterEach(async () => {
  await fixture?.close();
});

async function save(userInputs = [pending]) {
  const snapshot: AppSnapshot = {
    sessions: [session],
    userInputs,
    cursor: { streamId: 'stream', seq: 0 },
    deviceStatus: 'online',
    permissions: [],
    terminal: null,
  };

  await fixture.database.db.pool.query('UPDATE devices SET snapshot=$1 WHERE id=$2', [
    JSON.stringify(snapshot),
    fixture.deviceId,
  ]);

  await fixture.database.db.pool.query('UPDATE sessions SET data=$1 WHERE device_id=$2 AND id=$3', [
    JSON.stringify(session),
    fixture.deviceId,
    session.id,
  ]);
}

function command(answers: UserInputAnswers = { style: { answers: ['Dark'] } }) {
  return {
    commandId: randomUUID(),
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    action: { type: 'user_input' as const, requestId: pending.requestId, answers },
  };
}

async function connect() {
  const device = fixture.connect('/ws/device', fixture.deviceToken);

  await device.next('authenticated');

  return device;
}

it('delivers the exact structured answer once even while the source is running', async () => {
  const device = await connect();
  const input = command();

  expect((await fixture.relay.command(fixture.principal, input)).status).toBe('accepted');
  expect((await fixture.relay.command(fixture.principal, input)).status).toBe('accepted');
  const frame = await device.next('command');

  expect(frame.command.action).toEqual(input.action);
  expect(device.frames.filter((frame) => frame.type === 'command')).toHaveLength(1);
});

it('rejects another owner and invalid question answers before dispatch', async () => {
  const device = await connect();
  const other = await fixture.relay.auth.authenticate(fixture.otherToken);

  await expect(fixture.relay.command(other, command())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const invalid = command({ foreign: { answers: ['Dark'] } });

  await expect(fixture.relay.command(fixture.principal, invalid)).rejects.toMatchObject({
    code: 'INVALID_USER_INPUT',
  });

  expect(device.frames.filter((frame) => frame.type === 'command')).toHaveLength(0);
});

it('rejects an expired or already removed native question', async () => {
  pending.expiresAt = Date.now() - 1;
  await save();
  await connect();

  await expect(fixture.relay.command(fixture.principal, command())).rejects.toMatchObject({
    code: 'USER_INPUT_EXPIRED',
  });
});

it('hides pending input when a device is offline', async () => {
  const response = await fetch(fixture.origin + '/devices/' + fixture.deviceId + '/snapshot', {
    headers: { authorization: 'Bearer ' + fixture.token },
  });

  const data = await response.json();

  expect(data.snapshot.userInputs).toEqual([]);
});
