import { expect, it } from 'vitest';
import { localFixture } from '../../helpers/local/local-runtime.js';

it('marks a session the owner created from the app once, so the lists can order it before its first message', async () => {
  const f = localFixture();

  try {
    f.monitor.markCreated(f.session.id, 1_000);
    f.monitor.markCreated(f.session.id, 2_000);
    f.monitor.markCreated('missing-session', 3_000);

    expect(f.monitor.snapshot().sessions.find((session) => session.id === f.session.id)?.createdAt).toBe(
      1_000,
    );
  } finally {
    await f.close();
  }
});
