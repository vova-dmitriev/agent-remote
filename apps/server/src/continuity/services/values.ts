import { createHash } from 'node:crypto';
import {
  BindingState,
  DeviceStatus,
  IntegrationState,
  SessionStatus,
  StatusConfidence,
  snapshotSchema,
  type ExecutionLink,
} from '../../../../../packages/protocol/src/index.js';
import { z } from 'zod';

export const uuid = z.uuid();
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function readySnapshot(snapshot: unknown, link: ExecutionLink) {
  const parsed = snapshotSchema.safeParse(snapshot);

  if (!parsed.success || parsed.data.deviceStatus !== DeviceStatus.Online) {
    return false;
  }

  const session = parsed.data.sessions.find((item) => item.id === link.nativeSessionId);

  return Boolean(
    session &&
    session.generation === link.generation &&
    session.binding === BindingState.Verified &&
    session.integrationState === IntegrationState.Ready &&
    session.statusConfidence === StatusConfidence.Observed &&
    session.status !== SessionStatus.Unknown &&
    session.status !== SessionStatus.Ended,
  );
}
