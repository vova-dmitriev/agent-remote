import { expect, it } from 'vitest';
import { chmod, lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { profileExecutionNamespace } from '../../../../apps/daemon/src/sessions/execution/namespace.js';
import { executionProfile } from '../../../helpers/execution-profile.js';
import { ErrorCode, executionProfileSummarySchema } from '@protocol';

it('allocates short private deterministic namespaces without exposing profile identity in socket paths', async () => {
  const root = await mkdtemp('/tmp/ar-test-');

  try {
    const a = executionProfileSummarySchema.parse(executionProfile());
    const b = { ...a, id: '00000000-0000-4000-8000-000000000002' };
    const first = await profileExecutionNamespace(a, root);
    const second = await profileExecutionNamespace(b, root);

    expect(first.directory).not.toBe(second.directory);
    expect(await profileExecutionNamespace(a, root)).toEqual(first);
    expect(Buffer.byteLength(first.socketPath)).toBeLessThan(104);
    expect(first.socketPath).not.toContain(a.identity!.accountRef);
    expect((await lstat(first.directory)).mode & 0o777).toBe(0o700);
    await chmod(first.directory, 0o777);
    await expect(profileExecutionNamespace(a, root)).rejects.toThrow(ErrorCode.CODEX_INVALID_SOCKET);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects substituted directories and overlong paths before starting any native process', async () => {
  const root = await mkdtemp('/tmp/ar-test-');
  const target = join(root, 'target');

  try {
    const profile = executionProfileSummarySchema.parse(executionProfile());
    const first = await profileExecutionNamespace(profile, root);

    await rm(first.directory, { recursive: true });
    await symlink(target, first.directory);
    await expect(profileExecutionNamespace(profile, root)).rejects.toThrow(ErrorCode.CODEX_INVALID_SOCKET);

    await expect(profileExecutionNamespace(profile, '/tmp/' + 'x'.repeat(110))).rejects.toThrow(
      ErrorCode.CODEX_INVALID_SOCKET,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
