import { expect, it } from 'vitest';
import { Monitor } from '../../../apps/daemon/src/monitor/monitor.js';
import { LocalStore } from '../../../apps/daemon/src/monitor/store.js';
import { AdapterRegistry, SourceAdapter } from '../../../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../../../apps/daemon/src/commands/permission-broker.js';
import { noCapabilities } from '@protocol';

it('exposes only safe current tool categories and clears completed, failed or waiting work', () => {
  const store = new LocalStore(':memory:', 'device');
  const permissions = new PermissionBroker();
  const adapters = new AdapterRegistry('device');

  adapters.register(
    new SourceAdapter({
      connectorId: 'native',
      kind: 'claude-code-cli',
      transport: 'hooks',
      sourceVersion: 'test',
      capabilities: noCapabilities,
      state: 'ready',
      reason: null,
    }),
  );

  const monitor = new Monitor({ deviceId: 'device', store, adapters, permissions });

  const hook = (event: string, toolName = 'Bash', id = 'tool-one') =>
    monitor.ingestHook(
      {
        hook_event_name: event,
        session_id: 'synthetic',
        tool_name: toolName,
        tool_use_id: id,
        tool_input: { command: 'private-token', description: 'private description' },
      },
      'native',
    );

  try {
    hook('SessionStart');
    hook('UserPromptSubmit');
    hook('PreToolUse');

    expect(monitor.snapshot().sessions[0]?.currentActivity).toMatchObject({
      id: 'tool-one',
      kind: 'command',
    });

    expect(JSON.stringify(monitor.snapshot())).not.toContain('private');
    hook('PostToolUse', 'Bash', 'different-tool');
    expect(monitor.snapshot().sessions[0]?.currentActivity).toBeDefined();
    hook('PostToolUse');
    expect(monitor.snapshot().sessions[0]?.currentActivity).toBeUndefined();

    for (const event of ['PostToolUseFailure', 'PermissionRequest', 'Stop', 'SessionEnd']) {
      hook('PreToolUse', 'Read');
      hook(event, 'Read');
      expect(monitor.snapshot().sessions[0]?.currentActivity).toBeUndefined();
    }
  } finally {
    permissions.close();
    store.close();
  }
});
