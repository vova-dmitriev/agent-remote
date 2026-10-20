import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ execute: vi.fn(), question: vi.fn(), close: vi.fn() }));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(
    () => {
      throw new Error('UNMOCKED_NATIVE_CALL');
    },
    {
      [Symbol.for('nodejs.util.promisify.custom')]: fake.execute,
    },
  );

  return { execFile };
});

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: fake.question, close: fake.close }),
}));

import { confirmOnMac, openTelegram } from '@daemon/cli/pairing/local.js';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const signal = () => new AbortController().signal;

beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});

afterAll(() => {
  Object.defineProperty(process, 'platform', originalPlatform);

  if (originalTTY) {
    Object.defineProperty(process.stdin, 'isTTY', originalTTY);
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
});

beforeEach(() => {
  vi.resetAllMocks();
});

it('opens Telegram with a fixed executable and URL argument', async () => {
  fake.execute.mockResolvedValue({ stdout: '' });
  await openTelegram('https://t.me/fixture_bot?start=pair_abc', signal());

  expect(fake.execute.mock.calls[0]?.slice(0, 2)).toEqual([
    'open',
    ['https://t.me/fixture_bot?start=pair_abc'],
  ]);
});

it('uses one native confirmation with the Telegram ID passed separately from AppleScript', async () => {
  fake.execute.mockResolvedValue({ stdout: 'Подключить\n' });
  expect(await confirmOnMac('101', signal())).toBe(true);
  const args = fake.execute.mock.calls[0]![1] as string[];

  expect(args[2]).toBe('101');
  expect(args[1]).toContain('Telegram ID:');
  expect(fake.execute).toHaveBeenCalledTimes(1);
  expect(fake.question).not.toHaveBeenCalled();
});

it('treats native Cancel as rejection without a second terminal prompt', async () => {
  fake.execute.mockRejectedValue({ stderr: 'User canceled. (-128)' });
  expect(await confirmOnMac('101', signal())).toBe(false);
  expect(fake.question).not.toHaveBeenCalled();
});

it('falls back to a local terminal and closes readline if macOS dialogs are unavailable', async () => {
  fake.execute.mockRejectedValue(new Error('ENOENT'));
  fake.question.mockResolvedValue('yes');
  expect(await confirmOnMac('101', signal())).toBe(true);
  expect(fake.question.mock.calls[0]![0]).toContain('Telegram ID 101');
  expect(fake.close).toHaveBeenCalledOnce();
});

it('closes the fallback terminal on cancellation', async () => {
  fake.execute.mockRejectedValue(new Error('ENOENT'));
  fake.question.mockRejectedValue(new Error('ABORTED'));
  await expect(confirmOnMac('101', signal())).rejects.toThrow('ABORTED');
  expect(fake.close).toHaveBeenCalledOnce();
});
