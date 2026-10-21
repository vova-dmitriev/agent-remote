import type { Session } from '@protocol';

export function sessionWithReadCapabilities(
  session: Session,
  historyWindow: boolean,
  subagentHistory: boolean,
): Session {
  if (!historyWindow && !subagentHistory) {
    return session;
  }

  return {
    ...session,
    capabilities: {
      ...session.capabilities,
      ...(historyWindow ? { historyWindow: true } : {}),
      ...(subagentHistory ? { subagentHistory: true } : {}),
    },
  };
}
