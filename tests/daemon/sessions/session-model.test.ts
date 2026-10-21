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

function models(sessions: Session[]) {
  const setSessionModel = vi.fn(() => true);
  const sendPrompt = vi.fn(async () => ({}));
  const setModel = vi.fn(async () => {});

  const service = new SessionModelSwitch({
    monitor: {
      session: (id: string) => sessions.find((item) => item.id === id),
      binding: (id: string) => ({ id }),
      setSessionModel,
    } as never,
    adapters: { resolve: () => ({ sendPrompt, setModel }) } as never,
  });

  return { service, setSessionModel, sendPrompt, setModel };
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
