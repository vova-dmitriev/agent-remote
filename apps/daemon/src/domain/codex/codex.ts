export const CodexItemType = {
  ImageGeneration: 'imageGeneration',
  SessionMeta: 'session_meta',
  TurnContext: 'turn_context',
  UserMessage: 'userMessage',
  AgentMessage: 'agentMessage',
  SteeringUserMessage: 'steeringUserMessage',
  UserInputResponse: 'userInputResponse',
  CollabAgentToolCall: 'collabAgentToolCall',
  SubAgentActivity: 'subAgentActivity',
  CommandExecution: 'commandExecution',
  FileChange: 'fileChange',
  WebSearch: 'webSearch',
  McpToolCall: 'mcpToolCall',
  DynamicToolCall: 'dynamicToolCall',
  ImageView: 'imageView',
} as const;

export type CodexItemType = (typeof CodexItemType)[keyof typeof CodexItemType];

/** Rollout records the usage collector reads besides `session_meta` and `turn_context`. */
export const CodexRolloutType = { EventMessage: 'event_msg' } as const;

export const CodexEventType = { TokenCount: 'token_count' } as const;

/** JSON-RPC's invalid-request code: Codex answers it to resuming a thread that has no rollout yet. */
export const JSON_RPC_INVALID_REQUEST = -32600;

/** Codex's shell tool, as its hooks name it; the command line is its `cmd`. */
export const CodexShellTool = 'exec_command';

export const CodexContentType = {
  InputImage: 'inputImage',
  Text: 'text',
  Image: 'image',
  LocalImage: 'localImage',
} as const;

export type CodexContentType = (typeof CodexContentType)[keyof typeof CodexContentType];

export const CodexTurnStatus = {
  InProgress: 'inProgress',
  Completed: 'completed',
  Failed: 'failed',
  Interrupted: 'interrupted',
} as const;

export type CodexTurnStatus = (typeof CodexTurnStatus)[keyof typeof CodexTurnStatus];

export const CodexRuntimeStatus = {
  Active: 'active',
  Idle: 'idle',
} as const;

export type CodexRuntimeStatus = (typeof CodexRuntimeStatus)[keyof typeof CodexRuntimeStatus];

export const CodexActiveFlag = {
  WaitingOnApproval: 'waitingOnApproval',
  WaitingOnUserInput: 'waitingOnUserInput',
} as const;

export type CodexActiveFlag = (typeof CodexActiveFlag)[keyof typeof CodexActiveFlag];

export const CodexApprovalDecision = {
  Accept: 'accept',
  Decline: 'decline',
} as const;

export type CodexApprovalDecision = (typeof CodexApprovalDecision)[keyof typeof CodexApprovalDecision];

export const CodexAgentStatus = {
  PendingInit: 'pendingInit',
  Running: 'running',
  Interrupted: 'interrupted',
  Completed: 'completed',
  Errored: 'errored',
  Shutdown: 'shutdown',
  NotFound: 'notFound',
  WaitingForInput: 'waitingForInput',
} as const;

export type CodexAgentStatus = (typeof CodexAgentStatus)[keyof typeof CodexAgentStatus];

export const CodexMethod = {
  ThreadLoadedList: 'thread/loaded/list',
  ThreadRead: 'thread/read',
  ThreadResume: 'thread/resume',
  ThreadTurnsList: 'thread/turns/list',
  ThreadItemsList: 'thread/items/list',
  TurnStart: 'turn/start',
  TurnSteer: 'turn/steer',
  TurnInterrupt: 'turn/interrupt',
  TurnStarted: 'turn/started',
  TurnCompleted: 'turn/completed',
  ItemStarted: 'item/started',
  ItemCompleted: 'item/completed',
  ItemAgentMessageDelta: 'item/agentMessage/delta',
  ItemToolRequestUserInput: 'item/tool/requestUserInput',
  ItemCommandExecutionRequestApproval: 'item/commandExecution/requestApproval',
  ItemFileChangeRequestApproval: 'item/fileChange/requestApproval',
  ThreadStatusChanged: 'thread/status/changed',
  ThreadNameUpdated: 'thread/name/updated',
  ThreadNameSet: 'thread/name/set',
  ThreadModelUpdated: 'thread/model/updated',
  ModelRerouted: 'model/rerouted',
  ServerRequestResolved: 'serverRequest/resolved',
  Initialize: 'initialize',
  Initialized: 'initialized',
  ModelList: 'model/list',
  AccountRead: 'account/read',
  AccountLoginStart: 'account/login/start',
  AccountLoginCancel: 'account/login/cancel',
  AccountRateLimitsRead: 'account/rateLimits/read',
  ConfigRead: 'config/read',
  ThreadList: 'thread/list',
} as const;

export type CodexMethod = (typeof CodexMethod)[keyof typeof CodexMethod];

export const CodexLaunchArgument = {
  Server: 'app-server',
  Listen: '--listen',
  UnixSocketPrefix: 'unix://',
} as const;
export type CodexLaunchArgument = (typeof CodexLaunchArgument)[keyof typeof CodexLaunchArgument];

export const CodexItemsView = {
  NotLoaded: 'notLoaded',
} as const;

export type CodexItemsView = (typeof CodexItemsView)[keyof typeof CodexItemsView];

export const CodexSortDirection = {
  Desc: 'desc',
} as const;

export type CodexSortDirection = (typeof CodexSortDirection)[keyof typeof CodexSortDirection];

export const CodexItemStatus = { InProgress: 'inProgress', Completed: 'completed' } as const;
export type CodexItemStatus = (typeof CodexItemStatus)[keyof typeof CodexItemStatus];

export const CodexSteeringStatus = { Accepted: 'accepted' } as const;
export type CodexSteeringStatus = (typeof CodexSteeringStatus)[keyof typeof CodexSteeringStatus];

export const CodexSubagentActivityKind = { Interrupted: 'interrupted' } as const;
export type CodexSubagentActivityKind =
  (typeof CodexSubagentActivityKind)[keyof typeof CodexSubagentActivityKind];
