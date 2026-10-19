import { randomUUID } from 'node:crypto';
import {
  BindingState,
  ErrorCode,
  IntegrationState,
  noCapabilities,
  sessionSchema,
  SessionStatus,
  StatusConfidence,
} from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { type AdapterRegistry } from '../../adapters/registry.js';
import { type Monitor } from '../../monitor/monitor.js';
import { type CodexBindingOptions } from '../binding/binding.js';
import { codexSessionIdentity } from '../binding/identity.js';

/**
 * Shows a thread whose state frames exceed the Codex IPC cap as its own unavailable session with
 * `CODEX_FRAME_TOO_LARGE`, so the UI names the reason instead of a generic disconnect.
 */
export function markCodexThreadTooLarge(
  options: CodexBindingOptions,
  deps: { monitor: Monitor; adapters: AdapterRegistry },
) {
  const { sessionId, connectorId, target } = codexSessionIdentity(options, deps.adapters.deviceIdentity());
  const existing = deps.monitor.session(sessionId);

  if (existing?.errorCode === ErrorCode.CODEX_FRAME_TOO_LARGE) {
    return;
  }

  if (existing) {
    if (existing.integrationState !== IntegrationState.Disconnected) {
      deps.monitor.invalidate(connectorId);
    }

    existing.errorCode = ErrorCode.CODEX_FRAME_TOO_LARGE;
    deps.monitor.emit(RuntimeEvent.Snapshot);

    return;
  }

  const generation = randomUUID();

  const session = sessionSchema.parse({
    id: sessionId,
    target,
    claudeSessionId: null,
    generation,
    status: SessionStatus.Unknown,
    binding: BindingState.Unverified,
    lastEventAt: Date.now(),
    capabilities: { ...noCapabilities },
    integrationState: IntegrationState.Disconnected,
    statusConfidence: StatusConfidence.Inferred,
    errorCode: ErrorCode.CODEX_FRAME_TOO_LARGE,
  });

  deps.monitor.addDesktop(session, { target, generation, localProof: randomUUID() });
}
