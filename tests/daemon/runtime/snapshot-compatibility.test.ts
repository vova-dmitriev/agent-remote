import { expect, it } from 'vitest';
import { snapshotForProtocol, type DaemonSnapshot } from '@daemon/runtime/snapshot-compatibility.js';

const snapshot = {
  sessions: [],
  sessionPages: {
    all: { cursor: null, hasMore: false },
    claude: { cursor: null, hasMore: false },
    codex: { cursor: null, hasMore: false },
  },
  deviceStatus: 'online',
  cursor: { streamId: 'stream', seq: 0 },
  permissions: [],
  userInputs: [
    {
      requestId: 'r',
      sessionId: 's',
      generation: 'g',
      turnId: 't',
      itemId: 'i',
      isBlocking: true,
      expiresAt: 1,
      questions: [
        {
          id: 'q',
          header: 'Select',
          question: 'Choose',
          isOther: false,
          isSecret: false,
          multiSelect: true,
          options: [{ label: 'A', description: '' }],
        },
      ],
    },
  ],
  terminal: null,
} as unknown as DaemonSnapshot;

it('strips v12-only page and multi-select fields for older negotiated peers without mutating current snapshots', () => {
  const legacy = snapshotForProtocol(snapshot, 11);
  const current = snapshotForProtocol(snapshot, 12);

  expect(legacy).not.toHaveProperty('sessionPages');
  expect(legacy.userInputs?.[0]?.questions[0]).not.toHaveProperty('multiSelect');
  expect(current).toHaveProperty('sessionPages');
  expect(current.userInputs?.[0]?.questions[0]).toHaveProperty('multiSelect', true);
  expect(snapshot).toHaveProperty('sessionPages');
  expect(snapshot.userInputs?.[0]?.questions[0]).toHaveProperty('multiSelect', true);
});
