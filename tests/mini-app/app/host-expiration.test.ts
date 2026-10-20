import { expect, it } from 'vitest';
import { ConnectionStatus, ErrorCode, FrameType } from '@protocol';
import { createSessionStore } from '@/entities/session/model/store/create-session-store.js';

it('keeps the terminal localized error code while clearing expired session state', () => {
  const store = createSessionStore();

  store.getState().receiveFrame({ type: FrameType.Error, code: ErrorCode.LOCAL_GRANT_REVOKED });
  store.getState().setConnection(ConnectionStatus.Expired);
  expect(store.getState().session.snapshot).toBeNull();
  expect(store.getState().error).toBe(ErrorCode.LOCAL_GRANT_REVOKED);
});
