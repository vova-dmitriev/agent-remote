import { expect, it, vi } from 'vitest';
import { ErrorCode, SessionRemoval, SessionStatus, type Session } from '@protocol';
import { SessionRemover } from '@daemon/sessions/session-removal.js';

const claude = {
  id: 's-claude',
  target: { kind: 'claude-code-cli' },
  claudeSessionId: 'c-1',
  cwd: '/synthetic/project',
  status: SessionStatus.Running,
} as unknown as Session;

const codex = {
  id: 's-codex',
  target: { kind: 'codex-cli', threadId: 't-1' },
  status: SessionStatus.Running,
} as unknown as Session;

function remover(sessions: Session[], archive = vi.fn(async () => {})) {
  const hide = vi.fn(() => true);
  const interrupt = vi.fn(async () => ({}));
  const stopClaude = vi.fn(async () => {});

  const service = new SessionRemover({
    monitor: {
      session: (id: string) => sessions.find((item) => item.id === id),
      binding: (id: string) => ({ id }),
      hide,
    } as never,
    adapters: { resolve: () => ({ interrupt }) } as never,
    codex: () => ({ archiveThread: archive }),
    stopClaude,
  });

  return { service, hide, interrupt, stopClaude, archive };
}

it('hides a session in Agent Remote only', async () => {
  const f = remover([claude, codex]);

  await f.service.remove('s-codex', SessionRemoval.Hide);

  expect(f.hide).toHaveBeenCalledWith('s-codex');
  expect(f.archive).not.toHaveBeenCalled();
  expect(f.interrupt).not.toHaveBeenCalled();
});

it('archives a Codex thread in Codex, and a Claude session, which has no archive, is only hidden', async () => {
  const f = remover([claude, codex]);

  await f.service.remove('s-codex', SessionRemoval.Archive);
  await f.service.remove('s-claude', SessionRemoval.Archive);

  expect(f.archive).toHaveBeenCalledWith('t-1');
  expect(f.stopClaude).not.toHaveBeenCalled();
  expect(f.hide.mock.calls).toEqual([['s-codex'], ['s-claude']]);
});

it('ends a session: stops the Claude process, interrupts and archives the Codex thread', async () => {
  const f = remover([claude, codex]);

  await f.service.remove('s-claude', SessionRemoval.End);
  await f.service.remove('s-codex', SessionRemoval.End);

  expect(f.stopClaude).toHaveBeenCalledWith(claude);
  expect(f.interrupt).toHaveBeenCalledWith({ id: 's-codex' });
  expect(f.archive).toHaveBeenCalledWith('t-1');
});

it('still hides a session when its agent refuses the archive', async () => {
  const f = remover(
    [codex],
    vi.fn(async () => {
      throw new Error('synthetic failure');
    }),
  );

  await f.service.remove('s-codex', SessionRemoval.Archive);

  expect(f.hide).toHaveBeenCalledWith('s-codex');
});

it('refuses an unknown session', async () => {
  await expect(remover([]).service.remove('missing', SessionRemoval.Hide)).rejects.toMatchObject({
    code: ErrorCode.NOT_FOUND,
  });
});
