import { createHash } from 'node:crypto';
import type { CodexBindingOptions } from '../../domain/codex/client.js';

/** Stable session and connector identity of one Codex thread on one endpoint of this device. */
export function codexSessionIdentity(options: CodexBindingOptions, deviceId: string) {
  const identity = createHash('sha256')
    .update(JSON.stringify([deviceId, options.kind, options.endpoint, options.threadId]))
    .digest('hex');

  const connectorId = 'codex-' + identity.slice(0, 32);

  return {
    sessionId: 'codex-' + identity,
    connectorId,
    target: { kind: options.kind, deviceId, connectorId, threadId: options.threadId },
  };
}
