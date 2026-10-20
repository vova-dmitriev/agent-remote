import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserInputBroker } from '../../../apps/daemon/src/commands/user-input-broker.js';
import type { PendingUserInput } from '@protocol';

const request = (): PendingUserInput => ({
  requestId: 'r',
  sessionId: 's',
  generation: 'g',
  turnId: 't',
  itemId: 'i',
  expiresAt: Date.now() + 1000,
  isBlocking: true,
  questions: [
    {
      id: 'q',
      header: 'Choice',
      question: 'Select a color',
      isOther: true,
      isSecret: false,
      options: [{ label: 'Blue', description: 'A color' }],
    },
  ],
});

afterEach(() => vi.useRealTimers());

describe('UserInputBroker', () => {
  it('validates before claiming and awaits the one native response', async () => {
    const broker = new UserInputBroker();
    const answers: unknown[] = [];
    let release!: () => void;

    broker.open(request(), async (value) => {
      answers.push(value);

      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    await expect(broker.submit('r', 'g', { wrong: { answers: ['Blue'] } })).rejects.toThrow(
      'INVALID_USER_INPUT',
    );

    expect(broker.pending()).toHaveLength(1);
    await expect(broker.submit('r', 'old', {})).rejects.toThrow('USER_INPUT_EXPIRED');
    let complete = false;

    const submission = broker.submit('r', 'g', { q: { answers: ['Custom'] } }).then(() => {
      complete = true;
    });

    expect(answers).toEqual([{ q: { answers: ['Custom'] } }]);
    expect(complete).toBe(false);
    expect(broker.pending()).toEqual([]);
    await expect(broker.submit('r', 'g', {})).rejects.toThrow('USER_INPUT_EXPIRED');
    release();
    await submission;
    broker.close();
  });

  it('explicit Skip sends exactly an empty answer map', async () => {
    const broker = new UserInputBroker();
    let native: unknown;

    broker.open(request(), (value) => {
      native = value;
    });

    await broker.submit('r', 'g', {});
    expect(native).toEqual({});
    broker.close();
  });

  it('expires or cancels without answering and never retries an uncertain write', async () => {
    vi.useFakeTimers();
    const broker = new UserInputBroker();
    let writes = 0;

    const callback = () => {
      writes++;
    };

    broker.open(request(), callback);
    await vi.advanceTimersByTimeAsync(1001);
    expect(broker.pending()).toEqual([]);
    expect(writes).toBe(0);
    broker.open(request(), callback);
    broker.cancelSession('s', 'g');
    expect(writes).toBe(0);

    broker.open(request(), () => {
      writes++;
      throw new Error('lost acknowledgement');
    });

    await expect(broker.submit('r', 'g', {})).rejects.toThrow('UNKNOWN_AFTER_WRITE');
    await expect(broker.submit('r', 'g', {})).rejects.toThrow('USER_INPUT_EXPIRED');
    expect(writes).toBe(1);
    broker.close();
  });
});
