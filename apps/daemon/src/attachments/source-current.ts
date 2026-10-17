import { SessionStatus, IntegrationState, type Session } from '../../../../packages/protocol/src/index.js';

/** Reading already-authorized history does not require a writable terminal binding. */
export function attachmentSourceCurrent(current: Session | undefined, source: Session): boolean {
  return (
    !!current &&
    current.id === source.id &&
    current.generation === source.generation &&
    current.target.deviceId === source.target.deviceId &&
    current.capabilities.observe &&
    current.capabilities.history &&
    current.status !== SessionStatus.Ended &&
    current.integrationState !== IntegrationState.Disconnected
  );
}
