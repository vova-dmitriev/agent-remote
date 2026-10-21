import { expect, it, vi } from 'vitest';
import { ErrorCode, SessionStatus, type Session } from '@protocol';
import { SessionModelSwitch } from '@daemon/sessions/session-model.js';

const claude = {
  id: 's-claude',
  target: { kind: 'claude-code-cli' },
  status: SessionStatus.Idle,
  capabilities: { prompt: true },
} as unknown as Session;

const codex = {
  id: 's-codex',
  target: { kind: 'codex-cli', threadId: 't-1' },
  status: SessionStatus.Running,
  capabilities: { prompt: true },
} as unknown as Session;

const watching = { ...claude, id: 's-watching', capabilities: { prompt: false } } as unknown as Session;

function models(sessions: Session[], screens: string[] = []) {
  const setSessionModel = vi.fn(() => true);
  const sendPrompt = vi.fn(async () => ({}));
  const setModel = vi.fn(async () => {});
  const pressEnter = vi.fn(async () => true);
  const readScreen = vi.fn(async () => screens.shift() ?? 'Set model to Synthetic');

  const service = new SessionModelSwitch({
    monitor: {
      session: (id: string) => sessions.find((item) => item.id === id),
      binding: (id: string) => ({ id }),
      setSessionModel,
    } as never,
    adapters: { resolve: () => ({ sendPrompt, setModel, pressEnter, readScreen }) } as never,
    wait: async () => {},
  });

  return { service, setSessionModel, sendPrompt, setModel, pressEnter };
}

it('switches a Codex thread from its next turn and shows the model at once', async () => {
  const f = models([codex]);

  await f.service.switch('s-codex', { model: 'synthetic-model', effort: 'high' });

  expect(f.setModel).toHaveBeenCalledWith({ id: 's-codex' }, { model: 'synthetic-model', effort: 'high' });
  expect(f.sendPrompt).not.toHaveBeenCalled();
  expect(f.setSessionModel).toHaveBeenCalledWith('s-codex', 'synthetic-model');
});

it('switches a Claude session with its own /model and /effort commands', async () => {
  const f = models([claude]);

  await f.service.switch('s-claude', { model: 'opus', effort: 'high' });

  expect(f.sendPrompt.mock.calls).toEqual([
    [{ id: 's-claude' }, '/model opus'],
    [{ id: 's-claude' }, '/effort high'],
  ]);

  expect(f.setSessionModel).toHaveBeenCalledWith('s-claude', 'opus');
});

it('refuses a Claude session that takes no typed input, and an unknown session', async () => {
  const f = models([watching]);

  await expect(f.service.switch('s-watching', { model: 'opus' })).rejects.toMatchObject({
    code: ErrorCode.CAPABILITY_UNAVAILABLE,
  });

  await expect(f.service.switch('missing', { model: 'opus' })).rejects.toMatchObject({
    code: ErrorCode.NOT_FOUND,
  });

  expect(f.sendPrompt).not.toHaveBeenCalled();
  expect(f.setSessionModel).not.toHaveBeenCalled();
});

it("confirms Claude's switch dialog itself, which offers Yes first, and leaves a screen without one alone", async () => {
  const dialog = [
    'Switch model?',
    'This conversation is cached for the current model.',
    '❯ 1. Yes, switch to Sonnet',
    '  2. No, go back',
  ];

  const f = models([claude], ['loading', dialog.join('\n')]);

  await f.service.switch('s-claude', { model: 'sonnet', effort: 'high' });

  // The model switch asked and was confirmed; the effort switch showed no dialog within the wait.
  expect(f.pressEnter).toHaveBeenCalledTimes(1);
  expect(f.sendPrompt).toHaveBeenCalledTimes(2);
});
