import { ConnectorId, ConnectorTransport, IntegrationReason, IntegrationState, TargetKind } from '@protocol';
import { type AdapterRegistry, SourceAdapter } from '../../adapters/registry.js';

export function registerNativeAdapter(
  adapters: AdapterRegistry,
  permissionsEnabled: boolean,
  inputEnabled = false,
) {
  adapters.register(
    new SourceAdapter({
      connectorId: ConnectorId.Native,
      kind: TargetKind.ClaudeCodeCli,
      transport: ConnectorTransport.Hooks,
      sourceVersion: 'installed-claude',
      capabilities: {
        observe: true,
        history: true,
        prompt: false,
        interrupt: false,
        permission: permissionsEnabled,
        userInput: inputEnabled,
        terminalSnapshot: false,
      },
      state: IntegrationState.Ready,
      reason: IntegrationReason.CliWrapperRequired,
    }),
  );
}
