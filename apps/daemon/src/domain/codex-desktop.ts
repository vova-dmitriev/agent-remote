export const CodexDesktopMethod = {
  Initialize: 'initialize',
  ThreadOwnerDiscovery: 'thread-owner-discovery',
  ThreadFollowerStartTurn: 'thread-follower-start-turn',
  ThreadFollowerInterruptTurn: 'thread-follower-interrupt-turn',
  ThreadStreamFollowingChanged: 'thread-stream-following-changed',
  ThreadFollowerCommandApprovalDecision: 'thread-follower-command-approval-decision',
  ThreadFollowerFileApprovalDecision: 'thread-follower-file-approval-decision',
  ThreadFollowerSteerTurn: 'thread-follower-steer-turn',
  ThreadFollowerSubmitUserInput: 'thread-follower-submit-user-input',
  ThreadStreamStateChanged: 'thread-stream-state-changed',
  ThreadFollowerReadModelSettings: 'thread-follower-read-model-settings',
  ThreadFollowerLoadCompleteHistory: 'thread-follower-load-complete-history',
} as const;

export type CodexDesktopMethod = (typeof CodexDesktopMethod)[keyof typeof CodexDesktopMethod];

export const CodexDesktopMessageType = {
  Request: 'request',
  Response: 'response',
  Broadcast: 'broadcast',
  ClientDiscoveryRequest: 'client-discovery-request',
  ClientDiscoveryResponse: 'client-discovery-response',
  ClientHello: 'client-hello',
} as const;

export type CodexDesktopMessageType = (typeof CodexDesktopMessageType)[keyof typeof CodexDesktopMessageType];

export const CodexDesktopChangeType = {
  Snapshot: 'snapshot',
  Patches: 'patches',
} as const;

export type CodexDesktopChangeType = (typeof CodexDesktopChangeType)[keyof typeof CodexDesktopChangeType];

export const CodexDesktopResultType = {
  Success: 'success',
} as const;

export type CodexDesktopResultType = (typeof CodexDesktopResultType)[keyof typeof CodexDesktopResultType];

export const CodexDesktopHost = {
  Local: 'local',
} as const;

export type CodexDesktopHost = (typeof CodexDesktopHost)[keyof typeof CodexDesktopHost];

export const CodexInterruptMode = {
  UserStop: 'user-stop',
} as const;

export type CodexInterruptMode = (typeof CodexInterruptMode)[keyof typeof CodexInterruptMode];

export const CodexTurnTrigger = {
  AsyncQuestion: 'send_user_message_async_question',
} as const;

export type CodexTurnTrigger = (typeof CodexTurnTrigger)[keyof typeof CodexTurnTrigger];

export const JsonPatchOperation = {
  Add: 'add',
  Remove: 'remove',
  Replace: 'replace',
} as const;

export type JsonPatchOperation = (typeof JsonPatchOperation)[keyof typeof JsonPatchOperation];
