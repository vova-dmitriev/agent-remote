import { FrameType, type ServerFrame } from '@protocol';
import { sessionWithReadCapabilities } from '../../domain/ports/history/read-capabilities.js';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalControllerOptions } from './types.js';

export function localSnapshot(
  options: LocalControllerOptions,
  ownerId: string,
  selected: string | null,
): ServerFrame {
  const snapshot = options.monitor.snapshot();

  snapshot.sessions = snapshot.sessions.map((raw) => {
    const source = sessionWithReadCapabilities(
      raw,
      options.hasHistoryReader?.(raw.id) ?? false,
      options.monitor.hasSubagentHistory(raw.id, raw.generation),
    );

    const title = options.documents.get(ownerId, source.id, LocalDocumentKind.Title).value;

    return typeof title === 'string' ? { ...source, title } : source;
  });

  if (snapshot.terminal?.sessionId !== selected) {
    snapshot.terminal = null;
  }

  return {
    type: FrameType.Snapshot,
    deviceId: options.deviceId,
    snapshot,
    connectors: options.adapters.list(snapshot.sessions),
  };
}
