import { RelayProtocolFeature } from '@protocol';
import type { Monitor } from '../monitor/monitor.js';

export type DaemonSnapshot = ReturnType<Monitor['snapshot']>;

export function snapshotForProtocol(snapshot: DaemonSnapshot, protocolVersion: number): DaemonSnapshot {
  const compatible = structuredClone(snapshot);

  if (protocolVersion < RelayProtocolFeature.SessionPages) {
    delete compatible.sessionPages;
  }

  if (protocolVersion < RelayProtocolFeature.UserInputMultiple) {
    for (const request of compatible.userInputs ?? []) {
      for (const question of request.questions) {
        delete question.multiSelect;
      }
    }
  }

  if (protocolVersion < RelayProtocolFeature.SessionUnread) {
    for (const session of compatible.sessions) {
      delete session.unread;
    }
  }

  return compatible;
}
