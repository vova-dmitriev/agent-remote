import { expect, it } from 'vitest';
import type { Session } from '@protocol';
import { attachmentSourceCurrent } from '../apps/daemon/src/attachments/content/source-current.js';

it('exports observed history independently of input availability while rejecting stale, ended and disconnected sources', () => {
  const source = {
    id: 'session',
    generation: 'g',
    target: { kind: 'claude-code-cli', deviceId: 'device', connectorId: 'native', claudeSessionId: 'source' },
    capabilities: { observe: true, history: true, prompt: false },
    binding: 'unverified',
    integrationState: 'needs_restart',
    status: 'idle',
  } as Session;

  expect(attachmentSourceCurrent(source, source)).toBe(true);
  expect(attachmentSourceCurrent({ ...source, generation: 'new' }, source)).toBe(false);

  expect(
    attachmentSourceCurrent({ ...source, target: { ...source.target, deviceId: 'other' } }, source),
  ).toBe(false);

  expect(attachmentSourceCurrent({ ...source, status: 'ended' }, source)).toBe(false);
  expect(attachmentSourceCurrent({ ...source, integrationState: 'disconnected' }, source)).toBe(false);

  expect(
    attachmentSourceCurrent({ ...source, capabilities: { ...source.capabilities, history: false } }, source),
  ).toBe(false);
});
