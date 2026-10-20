import { describe, it, expect } from 'vitest';
import { cmuxContext } from '../../../apps/daemon/src/cmux/context.js';

const ids = {
  CMUX_WORKSPACE_ID: '22222222-2222-4222-8222-222222222222',
  CMUX_SURFACE_ID: '33333333-3333-4333-8333-333333333333',
  CMUX_WINDOW_ID: '11111111-1111-4111-8111-111111111111',
};

describe('local cmux context', () => {
  it('takes only explicit UUIDs inherited from the selected local terminal', () => {
    expect(cmuxContext(ids)).toEqual({
      windowId: ids.CMUX_WINDOW_ID,
      workspaceId: ids.CMUX_WORKSPACE_ID,
      surfaceId: ids.CMUX_SURFACE_ID,
    });

    expect(() => cmuxContext({ ...ids, CMUX_WINDOW_ID: 'current' })).toThrow('INVALID_CMUX_CONTEXT');
    expect(() => cmuxContext({})).toThrow('INVALID_CMUX_CONTEXT');
  });
});
