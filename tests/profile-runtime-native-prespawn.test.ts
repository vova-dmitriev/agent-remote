import { expect, it, vi } from 'vitest';
import { ErrorCode } from '@protocol';
import { CodexProfileNative } from '../apps/daemon/src/profiles/native/codex.js';
import { RuntimeProfileNative } from '../apps/daemon/src/profiles/runtime/native.js';
import { codexSubscription } from './profiles/registry.fixture.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

it('confirms an owned pre-spawn verification has no native child before removal proceeds', async () => {
  const f = profileServiceFixture();
  const profile = f.service.registry.create(codexSubscription);

  const native = new RuntimeProfileNative(
    { ...f.options, inputEnabled: true, baseEnvironment: {}, native: { executable: process.execPath } },
    f.service.registry,
  );

  const open = vi.spyOn(CodexProfileNative, 'open');
  let current = true;
  const verifying = native.verify(profile, () => current);

  current = false;
  const closed = native.closeProfile(profile.id);

  await expect(verifying).rejects.toThrow(ErrorCode.UNAUTHORIZED);
  await expect(closed).resolves.toBe(true);
  expect(open).not.toHaveBeenCalled();
});
