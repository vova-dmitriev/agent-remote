import { expect, it, vi } from 'vitest';
import { ErrorCode, type Session } from '@protocol';
import { SessionNames } from '@daemon/sessions/session-names.js';

const claude = {
  id: 's-claude',
  target: { kind: 'claude-code-cli' },
  claudeSessionId: 'c-1',
} as unknown as Session;

const codex = {
  id: 's-codex',
  target: { kind: 'codex-cli', threadId: 't-1' },
  claudeSessionId: null,
} as unknown as Session;

function names(
  sessions: Session[],
  overrides: { append?: () => Promise<boolean>; renameThread?: () => Promise<boolean> } = {},
) {
  const setSessionTitle = vi.fn();
  const appendTitle = vi.fn(overrides.append ?? (async () => true));
  const renameThread = vi.fn(overrides.renameThread ?? (async () => true));

  const service = new SessionNames({
    monitor: { session: (id: string) => sessions.find((item) => item.id === id), setSessionTitle } as never,
    readers: { appendTitle } as never,
    codex: () => ({ renameThread }),
  });

  return { service, setSessionTitle, appendTitle, renameThread };
}

it('names a Claude session in its transcript and a Codex thread through its app-server', async () => {
  const f = names([claude, codex]);

  expect(await f.service.rename('s-claude', '  Claude name  ')).toBe(true);
  expect(f.appendTitle).toHaveBeenCalledWith('s-claude', 'Claude name');
  expect(await f.service.rename('s-codex', 'Codex name')).toBe(true);
  expect(f.renameThread).toHaveBeenCalledWith('t-1', 'Codex name');

  expect(f.setSessionTitle.mock.calls).toEqual([
    ['s-claude', 'Claude name'],
    ['s-codex', 'Codex name'],
  ]);
});

it('still shows the name when the agent cannot take it, and says so', async () => {
  const f = names([claude, codex], {
    append: async () => {
      throw new Error(ErrorCode.TRANSCRIPT_UNAVAILABLE);
    },
    renameThread: async () => false,
  });

  expect(await f.service.rename('s-claude', 'Name')).toBe(false);
  expect(await f.service.rename('s-codex', 'Name')).toBe(false);
  expect(f.setSessionTitle).toHaveBeenCalledTimes(2);
});

it('refuses an unknown session or an empty name without touching anything', async () => {
  const f = names([claude]);

  await expect(f.service.rename('missing', 'Name')).rejects.toThrow(ErrorCode.NOT_FOUND);
  await expect(f.service.rename('s-claude', '   ')).rejects.toThrow(ErrorCode.INVALID_REQUEST);
  expect(f.appendTitle).not.toHaveBeenCalled();
  expect(f.setSessionTitle).not.toHaveBeenCalled();
});
