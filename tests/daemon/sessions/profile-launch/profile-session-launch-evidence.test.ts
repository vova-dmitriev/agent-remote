import { expect, it, vi } from 'vitest';
import type { ProfiledExecutionLaunch } from '@daemon/sessions/execution/types.js';
import { executionProfile, executionSelection } from '../../../helpers/sessions/execution-profile.js';
import { executionProfileSummarySchema } from '@protocol';
import { startProfiledCodexRuntime } from '@daemon/sessions/execution/start-profiled-codex.js';
import { ManagedCodexLaunchEvidenceType } from '@daemon/codex/launch/types.js';

const launcher = vi.hoisted(() => ({ ensure: vi.fn() }));

vi.mock('@daemon/codex/launcher.js', () => ({
  ensureManagedCodexSocket: launcher.ensure,
}));

it('releases the reservation only when the launcher positively reports no child was created', async () => {
  const profile = executionProfileSummarySchema.parse(executionProfile());

  const lease = {
    id: 'no-child',
    bindSocket: vi.fn(),
    bindProcess: vi.fn(),
    processId: vi.fn(() => undefined),
    markReady: vi.fn(),
    releaseBeforeLaunch: vi.fn(),
    releaseAfterExit: vi.fn(),
  };

  const launch = {
    profile,
    selection: executionSelection(),
    environment: { CODEX_HOME: '/synthetic/codex' },
    assertCurrent: vi.fn(),
    executionLease: lease,
  } as unknown as ProfiledExecutionLaunch;

  launcher.ensure.mockImplementationOnce(
    async (_directory: string, _executable: string, options: unknown) => {
      (options as { onEvidence?: (event: unknown) => void }).onEvidence?.({
        type: ManagedCodexLaunchEvidenceType.NoChildCreated,
      });

      throw new Error('synthetic pre-spawn failure');
    },
  );

  await expect(startProfiledCodexRuntime(launch, { namespaceRoot: '/tmp' })).rejects.toThrow(
    'synthetic pre-spawn failure',
  );

  expect(lease.releaseBeforeLaunch).toHaveBeenCalledOnce();
  expect(lease.releaseAfterExit).not.toHaveBeenCalled();
});

it('retains the reservation when startup outcome has no child evidence', async () => {
  const profile = executionProfileSummarySchema.parse(executionProfile());

  const lease = {
    id: 'unknown-child',
    bindSocket: vi.fn(),
    bindProcess: vi.fn(),
    processId: vi.fn(() => undefined),
    markReady: vi.fn(),
    releaseBeforeLaunch: vi.fn(),
    releaseAfterExit: vi.fn(),
  };

  const launch = {
    profile,
    selection: executionSelection(),
    environment: { CODEX_HOME: '/synthetic/codex' },
    assertCurrent: vi.fn(),
    executionLease: lease,
  } as unknown as ProfiledExecutionLaunch;

  launcher.ensure.mockRejectedValueOnce(new Error('synthetic unknown launch outcome'));

  await expect(startProfiledCodexRuntime(launch, { namespaceRoot: '/tmp' })).rejects.toThrow(
    'synthetic unknown launch outcome',
  );

  expect(lease.releaseBeforeLaunch).not.toHaveBeenCalled();
});

it('releases a reservation only after a positively owned child reports exit', async () => {
  const profile = executionProfileSummarySchema.parse(executionProfile());

  const lease = {
    id: 'owned-child',
    bindSocket: vi.fn(),
    bindProcess: vi.fn(),
    processId: vi.fn(() => undefined),
    markReady: vi.fn(),
    releaseBeforeLaunch: vi.fn(),
    releaseAfterExit: vi.fn(),
  };

  const launch = {
    profile,
    selection: executionSelection(),
    environment: { CODEX_HOME: '/synthetic/codex' },
    assertCurrent: vi.fn(),
    executionLease: lease,
  } as unknown as ProfiledExecutionLaunch;

  launcher.ensure.mockImplementationOnce(
    async (_directory: string, _executable: string, options: unknown) => {
      const report = (options as { onEvidence?: (event: unknown) => void }).onEvidence;

      report?.({ type: ManagedCodexLaunchEvidenceType.ChildCreated, pid: 91001 });
      report?.({ type: ManagedCodexLaunchEvidenceType.ChildExited, pid: 91001 });
      throw new Error('synthetic owned child exited');
    },
  );

  await expect(startProfiledCodexRuntime(launch, { namespaceRoot: '/tmp' })).rejects.toThrow(
    'synthetic owned child exited',
  );

  expect(lease.bindProcess).toHaveBeenCalledWith(91001);
  expect(lease.releaseAfterExit).toHaveBeenCalledOnce();
  expect(lease.releaseBeforeLaunch).not.toHaveBeenCalled();
});
