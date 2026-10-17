import { beforeEach, expect, it, vi } from 'vitest';

const pairing = vi.hoisted(() => ({ connectMac: vi.fn(), ensureMacConnected: vi.fn() }));

vi.mock('../../apps/daemon/src/cli/pairing/connect.js', () => pairing);
import { runCli } from '../../apps/daemon/src/setup-cli.js';

beforeEach(() => {
  vi.clearAllMocks();
  pairing.connectMac.mockResolvedValue(true);
  pairing.ensureMacConnected.mockResolvedValue(true);
});

it('explicit connect starts local approval again without requiring manual config deletion', async () => {
  await runCli(['connect']);
  expect(pairing.connectMac).toHaveBeenCalledWith({ manual: false, signal: expect.any(AbortSignal) });
  expect(pairing.ensureMacConnected).not.toHaveBeenCalled();
});

it('keeps the legacy manual pair command and relay argument', async () => {
  await runCli(['pair', 'https://fixture.example']);

  expect(pairing.connectMac).toHaveBeenCalledWith({
    relayUrl: 'https://fixture.example',
    manual: true,
    signal: expect.any(AbortSignal),
  });
});
