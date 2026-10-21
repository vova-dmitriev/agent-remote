import {
  AgentProvider,
  CommandActionType,
  CommandStatus,
  PromptDelivery,
  RemotePermissionDecision,
} from './command-values.js';
import {
  BindingState,
  DeviceStatus,
  IntegrationState,
  MAX_DEVICE_CONNECTORS,
  MAX_DEVICE_SESSIONS,
  NativeRestartState,
  SessionListLimits,
  SessionRemoval,
  SessionStatus,
  StatusConfidence,
} from './values.js';
import { ConnectorTransport, FrameType, MessageRole, TargetKind } from '../connection/values.js';
import { ProviderFilterValue } from '../connection/host.js';
import { AttachmentMode } from '../history/values.js';
import { ErrorCode } from '../errors/error-codes.js';
import { z } from 'zod';
import { sessionChangesSchema, sessionFileQuerySchema, sessionFileSchema } from './file-changes.js';
import { permissionRuleSchema, rulesReplySchema, rulesRequestSchema } from '../rules/schemas.js';
import { skillsRequestFrameSchema, skillsResultFrameSchema } from '../skills/frames.js';
import {
  analyticsQuerySchema,
  analyticsReportSchema,
  rateLimitsSchema,
  sessionUsageSchema,
} from '../analytics/schemas.js';
import { sessionActivitySchema, toolActivitySchema } from './activity.js';
import { historyReadSchema, historyDoneSchema } from '../history/history-window.js';
import { subagentSchema } from './subagents.js';
import { validatePrompt } from '../errors/validation.js';
import { attachmentsSchema } from '../history/attachments.js';
import { pendingUserInputSchema, userInputAnswersSchema } from '../input/user-input.js';
import { profileRequestSchema, profileReplySchema } from '../profile/profile-access.js';
import {
  executionLaunchSelectionSchema,
  modelChoiceSchema,
  providerModelsSchema,
} from '../execution/execution-profile.js';
import { executionVersionSchema } from '../execution/execution-fields.js';
import {
  continuityLocalRequestSchema,
  continuityLocalResponseSchema,
} from '../continuity/continuity-access.js';

const id = z.string().min(1).max(512);
const time = z.number().int().nonnegative().safe();
const base = { deviceId: id, connectorId: id };

export const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(TargetKind.Cmux),
    ...base,
    windowId: z.uuid(),
    workspaceId: z.uuid(),
    surfaceId: z.uuid(),
  }),
  z.strictObject({ kind: z.literal(TargetKind.ClaudeCodeCli), ...base, claudeSessionId: id }),
  z.strictObject({ kind: z.literal(TargetKind.ClaudeCodeDesktop), ...base, claudeSessionId: id }),
  z.strictObject({ kind: z.literal(TargetKind.ClaudeDesktopChat), ...base, chatBindingId: id }),
  z.strictObject({ kind: z.literal(TargetKind.CodexCli), ...base, threadId: id }),
  z.strictObject({ kind: z.literal(TargetKind.CodexDesktop), ...base, threadId: id }),
]);
/** Readers strip capabilities added by a newer writer instead of rejecting the snapshot. */
export const capabilitySchema = z.object({
  observe: z.boolean(),
  history: z.boolean(),
  historyWindow: z.boolean().optional(),
  subagentHistory: z.boolean().optional(),
  prompt: z.boolean(),
  interrupt: z.boolean(),
  permission: z.boolean(),
  userInput: z.boolean().optional(),
  createSession: z.boolean().optional(),
  restartSession: z.boolean().optional(),
  terminalSnapshot: z.boolean(),
  attachments: z
    .strictObject({ images: z.enum(AttachmentMode), files: z.literal(AttachmentMode.Reference) })
    .optional(),
});
export const integrationStateSchema = z.enum(IntegrationState);
export const statusSchema = z.enum(SessionStatus);

/**
 * Session-level reasons. Readers tolerate a reason added by a newer writer: an unknown code reads
 * as the generic `SESSION_UNAVAILABLE` instead of rejecting the whole snapshot frame.
 */
const sessionErrorCodeSchema = z
  .enum([
    ErrorCode.CODEX_MODEL_UNAVAILABLE,
    ErrorCode.CODEX_AUTH_REQUIRED,
    ErrorCode.CODEX_NETWORK_ERROR,
    ErrorCode.CODEX_TURN_FAILED,
    ErrorCode.CODEX_FRAME_TOO_LARGE,
    ErrorCode.SESSION_UNAVAILABLE,
  ])
  .catch(ErrorCode.SESSION_UNAVAILABLE);

export const sessionSchema = z
  .strictObject({
    id,
    title: z.string().trim().min(1).max(512).optional(),
    cwd: z
      .string()
      .min(1)
      .max(4096)
      // eslint-disable-next-line no-control-regex -- Intentionally reject control characters at the wire boundary.
      .regex(/^\/[^\u0000-\u001f\u007f]*$/u)
      .optional(),
    currentActivity: sessionActivitySchema.optional(),
    changes: sessionChangesSchema.optional(),
    usage: sessionUsageSchema.optional(),
    /** The agent's own permission mode as its hooks report it, e.g. `bypassPermissions`. */
    permissionMode: z.string().min(1).max(64).optional(),
    subagents: z.array(subagentSchema).max(50).optional(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(256)
      // eslint-disable-next-line no-control-regex -- Intentionally reject control characters at the wire boundary.
      .regex(/^[^\u0000-\u001f\u007f<>]+$/u)
      .optional(),
    errorCode: sessionErrorCodeSchema.optional(),
    target: targetSchema,
    claudeSessionId: id.nullable(),
    generation: id,
    status: statusSchema,
    binding: z.enum(BindingState),
    lastEventAt: time,
    lastMessageAt: time.optional(),
    /** When the owner created the session from the app; it orders the session until its first message. */
    createdAt: time.optional(),
    /** Present only when the owner pinned the session; the device keeps pins and puts them in its snapshot. */
    pinned: z.literal(true).optional(),
    capabilities: capabilitySchema,
    nativeRestartState: z.enum(NativeRestartState).optional(),
    integrationState: integrationStateSchema,
    statusConfidence: z.enum(StatusConfidence),
  })
  .refine(
    (s) =>
      s.target.kind !== TargetKind.ClaudeDesktopChat ||
      (!s.capabilities.permission && !s.capabilities.terminalSnapshot),
    'Chat cannot expose Code/terminal capabilities',
  )
  .refine(
    (s) =>
      ![TargetKind.CodexCli, TargetKind.CodexDesktop].some((kind) => kind === s.target.kind) ||
      s.claudeSessionId === null,
    'Codex must use its own thread identity',
  );
/** Pins or unpins a session of the current generation; the device holds the pin. */
export const sessionPinSchema = z.strictObject({ pinned: z.boolean(), generation: id });
export type SessionPin = z.infer<typeof sessionPinSchema>;
/** Switches a session of the current generation to another model; it applies from the session's next turn. */
export const sessionModelChoiceSchema = z.strictObject({ choice: modelChoiceSchema, generation: id });
export type SessionModelChoice = z.infer<typeof sessionModelChoiceSchema>;
/** Removes a session of the current generation from the lists; the device holds what it hid. */
export const sessionRemoveSchema = z.strictObject({ mode: z.enum(SessionRemoval), generation: id });
export type SessionRemove = z.infer<typeof sessionRemoveSchema>;
export const actionSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      type: z.literal(CommandActionType.Prompt),
      text: z.string().refine((text) => {
        try {
          validatePrompt(text);

          return true;
        } catch {
          return false;
        }
      }, ErrorCode.INVALID_PROMPT),
      attachments: attachmentsSchema.optional(),
      delivery: z.enum(PromptDelivery).optional(),
    })
    .refine((action) => Boolean(action.text.trim() || action.attachments?.length), ErrorCode.EMPTY_PROMPT),
  z
    .strictObject({
      type: z.literal(CommandActionType.CreateSession),
      provider: z.enum(AgentProvider),
      cwd: z
        .string()
        .min(1)
        .max(4096)
        // eslint-disable-next-line no-control-regex -- Intentionally reject control characters at the wire boundary.
        .regex(/^\/[^\u0000-\u001f\u007f]*$/u),
      execution: z
        .strictObject({
          selection: executionLaunchSelectionSchema,
          expectedVersion: executionVersionSchema,
        })
        .optional(),
      /** The model on the device's own sign-in; a profile launch names its model in `execution` instead. */
      model: modelChoiceSchema.optional(),
    })
    .refine((action) => !(action.execution && action.model), { message: ErrorCode.INVALID_COMMAND })
    .refine((action) => !action.execution || action.execution.selection.provider === action.provider, {
      message: ErrorCode.PROFILE_MISMATCH,
    }),
  z.strictObject({ type: z.literal(CommandActionType.RestartSession) }),
  z.strictObject({ type: z.literal(CommandActionType.Escape) }),
  z.strictObject({ type: z.literal(CommandActionType.Interrupt) }),
  z.strictObject({
    type: z.literal(CommandActionType.Permission),
    requestId: id,
    decision: z.enum(RemotePermissionDecision),
  }),
  z.strictObject({
    type: z.literal(CommandActionType.UserInput),
    requestId: id,
    answers: userInputAnswersSchema,
  }),
]);

const commandFields = {
  commandId: id,
  target: targetSchema,
  sessionId: id,
  generation: id,
  action: actionSchema,
};

export const clientCommandSchema = z.strictObject(commandFields);
export const commandSchema = z.strictObject({ version: z.literal(1), ...commandFields, expiresAt: time });
export const resultSchema = z.strictObject({
  commandId: id,
  status: z.enum(CommandStatus),
  code: id.optional(),
  sessionId: id.optional(),
});
export const cursorSchema = z.strictObject({ streamId: id, seq: time });
export const eventSchema = z.strictObject({
  version: z.literal(1),
  deviceId: id,
  streamId: id,
  seq: time,
  eventId: id,
  sessionId: id.nullable(),
  occurredAt: time,
  type: id,
  payload: z.unknown(),
});
export const permissionSchema = z.strictObject({
  requestId: id,
  sessionId: id,
  generation: id,
  toolName: id,
  input: z.unknown(),
  expiresAt: time,
  /** Present when an owner's rule stopped the command rather than the agent asking. */
  rule: permissionRuleSchema.optional(),
});
/** Readers strip fields added by a newer writer instead of rejecting the history frame. */
export const historySchema = z.object({
  id,
  historyCursor: z.string().max(2048).optional(),
  role: z.enum(MessageRole),
  text: z.string().max(65_536),
  occurredAt: time,
  attachments: attachmentsSchema.optional(),
  tool: toolActivitySchema.optional(),
});
export const terminalSchema = z.strictObject({
  sessionId: id,
  generation: id,
  text: z.string().max(65_536),
  capturedAt: time,
});
export const connectorSchema = z.strictObject({
  connectorId: id,
  kind: z.enum(TargetKind),
  transport: z.enum(ConnectorTransport),
  sourceVersion: z.string().max(128),
  capabilities: capabilitySchema,
  state: integrationStateSchema,
  reason: z.string().max(1024).nullable(),
});
export const snapshotSchema = z.strictObject({
  sessions: z.array(sessionSchema).max(MAX_DEVICE_SESSIONS),
  sessionPages: z
    .strictObject({
      all: z.strictObject({
        cursor: z.string().max(SessionListLimits.DeviceCursorLength).nullable(),
        hasMore: z.boolean(),
      }),
      claude: z.strictObject({
        cursor: z.string().max(SessionListLimits.DeviceCursorLength).nullable(),
        hasMore: z.boolean(),
      }),
      codex: z.strictObject({
        cursor: z.string().max(SessionListLimits.DeviceCursorLength).nullable(),
        hasMore: z.boolean(),
      }),
    })
    .optional(),
  deviceStatus: z.enum(DeviceStatus),
  cursor: cursorSchema,
  permissions: z.array(permissionSchema).max(100),
  userInputs: z.array(pendingUserInputSchema).max(100).optional(),
  terminal: terminalSchema.nullable(),
  /** The plan limits of the device's agents, for the session header. */
  rateLimits: rateLimitsSchema.optional(),
  /** The models the device's own sign-in of each agent offers. */
  models: z.array(providerModelsSchema).max(2).optional(),
});
export const appFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(FrameType.Auth), token: id }),
  z.strictObject({ type: z.literal(FrameType.Subscribe), deviceId: id, sessionId: id.nullable() }),
  z.strictObject({ type: z.literal(FrameType.Resume), deviceId: id, cursor: cursorSchema }),
  z.strictObject({ type: z.literal(FrameType.Command), command: clientCommandSchema }),
]);
export const handoffSeedProofFrameSchema = z.strictObject({
  type: z.literal(FrameType.HandoffSeedProof),
  operationId: z.uuid(),
  seedCommandId: z.uuid(),
  checkpointId: z.uuid(),
  checkpointDigest: z.string().regex(/^[a-f0-9]{64}$/),
  targetExecutionId: z.uuid(),
  targetGeneration: z.uuid(),
  selection: executionLaunchSelectionSchema,
});

const handoffSeedCorrelation = {
  operationId: z.uuid(),
  seedCommandId: z.uuid(),
  checkpointId: z.uuid(),
  checkpointDigest: z.string().regex(/^[a-f0-9]{64}$/),
  targetExecutionId: z.uuid(),
  targetGeneration: z.uuid(),
  selection: executionLaunchSelectionSchema,
};

export const handoffSeedIntentFrameSchema = z.strictObject({
  type: z.literal(FrameType.HandoffSeedIntent),
  ...handoffSeedCorrelation,
});
export const handoffSeedAdmissionFrameSchema = z.strictObject({
  type: z.literal(FrameType.HandoffSeedAdmitted),
  ...handoffSeedCorrelation,
});
export const continuityRequestFrameSchema = z.strictObject({
  type: z.literal(FrameType.ContinuityRequest),
  requestId: z.uuid(),
  epoch: id,
  request: continuityLocalRequestSchema,
});
export const continuityResultFrameSchema = z.strictObject({
  type: z.literal(FrameType.ContinuityResult),
  requestId: z.uuid(),
  epoch: id,
  reply: z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), response: continuityLocalResponseSchema }),
    z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
  ]),
});
export const sessionListReadFrameSchema = z.strictObject({
  type: z.literal(FrameType.SessionListRead),
  requestId: z.uuid(),
  provider: z.enum(ProviderFilterValue),
  cursor: z.string().max(SessionListLimits.DeviceCursorLength).optional(),
});
export const sessionListResultFrameSchema = z.strictObject({
  type: z.literal(FrameType.SessionListResult),
  requestId: z.uuid(),
  reply: z.discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true),
      page: z.strictObject({
        sessions: z.array(sessionSchema).max(SessionListLimits.PageSize),
        nextCursor: z.string().max(SessionListLimits.DeviceCursorLength).nullable(),
      }),
    }),
    z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
  ]),
});
export const deviceFrameSchema = z.discriminatedUnion('type', [
  skillsResultFrameSchema,
  sessionListResultFrameSchema,
  z.strictObject({
    type: z.literal(FrameType.ProfilesResult),
    requestId: z.uuid(),
    epoch: id,
    reply: profileReplySchema,
  }),
  historyDoneSchema,
  z.strictObject({
    type: z.literal(FrameType.FileResult),
    requestId: z.uuid(),
    reply: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), file: sessionFileSchema }),
      z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
    ]),
  }),
  z.strictObject({
    type: z.literal(FrameType.SessionModelResult),
    requestId: z.uuid(),
    reply: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), choice: modelChoiceSchema }),
      z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
    ]),
  }),
  z.strictObject({
    type: z.literal(FrameType.RulesResult),
    requestId: z.uuid(),
    reply: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), rules: rulesReplySchema }),
      z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
    ]),
  }),
  z.strictObject({
    type: z.literal(FrameType.AnalyticsResult),
    requestId: z.uuid(),
    reply: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), report: analyticsReportSchema }),
      z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
    ]),
  }),
  z.strictObject({
    type: z.literal(FrameType.HistoryItem),
    requestId: id,
    sessionId: id,
    generation: id,
    message: historySchema,
  }),
  // Tolerant on purpose, unlike the other frames: unknown fields are stripped, so a newer daemon's extra `Auth`
  // field never locks it out of an older relay again. `type`, `token` and `protocolVersion` stay validated.
  z.object({
    type: z.literal(FrameType.Auth),
    token: id,
    /** Absent from a daemon older than the handshake: version 1. */
    protocolVersion: z.number().int().positive().optional(),
  }),
  z.strictObject({ type: z.literal(FrameType.Heartbeat) }),
  z.strictObject({
    type: z.literal(FrameType.Snapshot),
    snapshot: snapshotSchema,
    connectors: z.array(connectorSchema).max(MAX_DEVICE_CONNECTORS),
  }),
  z.strictObject({ type: z.literal(FrameType.Event), event: eventSchema }),
  z.strictObject({ type: z.literal(FrameType.CommandResult), result: resultSchema }),
  handoffSeedProofFrameSchema,
  handoffSeedIntentFrameSchema,
  continuityResultFrameSchema,
]);
export const serverFrameSchema = z.discriminatedUnion('type', [
  skillsRequestFrameSchema,
  sessionListReadFrameSchema,
  z.strictObject({ type: z.literal(FrameType.ProfilesCancel), requestId: z.uuid(), epoch: id }),
  z.strictObject({
    type: z.literal(FrameType.ProfilesRequest),
    requestId: z.uuid(),
    epoch: id,
    request: profileRequestSchema,
  }),
  historyReadSchema,
  z.strictObject({
    type: z.literal(FrameType.Authenticated),
    epoch: id.optional(),
    /** The negotiated version, sent only to a daemon that announced one. */
    protocolVersion: z.number().int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal(FrameType.Snapshot),
    deviceId: id,
    snapshot: snapshotSchema,
    connectors: z.array(connectorSchema).max(MAX_DEVICE_CONNECTORS),
  }),
  z.strictObject({ type: z.literal(FrameType.Event), event: eventSchema }),
  z.strictObject({ type: z.literal(FrameType.CommandResult), result: resultSchema }),
  z.strictObject({ type: z.literal(FrameType.ResyncRequired), deviceId: id }),
  z.strictObject({ type: z.literal(FrameType.DeviceStatus), deviceId: id, status: z.enum(DeviceStatus) }),
  z.strictObject({ type: z.literal(FrameType.Error), code: id }),
  z.strictObject({ type: z.literal(FrameType.Select), sessionId: id.nullable() }),
  z.strictObject({ type: z.literal(FrameType.SessionPin), sessionId: id, pinned: z.boolean() }),
  z.strictObject({ type: z.literal(FrameType.SessionRemove), sessionId: id, mode: z.enum(SessionRemoval) }),
  z.strictObject({
    type: z.literal(FrameType.SessionModel),
    requestId: z.uuid(),
    sessionId: id,
    choice: modelChoiceSchema,
  }),
  z.strictObject({
    type: z.literal(FrameType.SessionRename),
    sessionId: id,
    title: z.string().trim().min(1).max(512),
  }),
  z.strictObject({ type: z.literal(FrameType.Command), command: commandSchema }),
  z.strictObject({ type: z.literal(FrameType.Ack), cursor: cursorSchema }),
  handoffSeedAdmissionFrameSchema,
  continuityRequestFrameSchema,
  z.strictObject({
    type: z.literal(FrameType.FileRequest),
    requestId: z.uuid(),
    sessionId: id,
    ...sessionFileQuerySchema.shape,
  }),
  z.strictObject({
    type: z.literal(FrameType.AnalyticsRequest),
    requestId: z.uuid(),
    ...analyticsQuerySchema.shape,
  }),
  z.strictObject({
    type: z.literal(FrameType.RulesRequest),
    requestId: z.uuid(),
    request: rulesRequestSchema,
  }),
]);
export type Target = z.infer<typeof targetSchema>;
export type CmuxTarget = Extract<Target, { kind: typeof TargetKind.Cmux }>;
export type CapabilitySet = z.infer<typeof capabilitySchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Command = z.infer<typeof commandSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type CommandResult = z.infer<typeof resultSchema>;
export type EventEnvelope = z.infer<typeof eventSchema>;
export type Cursor = z.infer<typeof cursorSchema>;
export type PendingPermission = z.infer<typeof permissionSchema>;
export type HistoryMessage = z.infer<typeof historySchema>;
export type ConnectorDescriptor = z.infer<typeof connectorSchema>;
export type AppSnapshot = z.infer<typeof snapshotSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;
export type AppFrame = z.infer<typeof appFrameSchema>;
export type DeviceFrame = z.infer<typeof deviceFrameSchema>;
export type HandoffSeedProofFrame = z.infer<typeof handoffSeedProofFrameSchema>;
export type HandoffSeedIntentFrame = z.infer<typeof handoffSeedIntentFrameSchema>;
export type HandoffSeedAdmissionFrame = z.infer<typeof handoffSeedAdmissionFrameSchema>;
export type ContinuityRequestFrame = z.infer<typeof continuityRequestFrameSchema>;
export type ContinuityResultFrame = z.infer<typeof continuityResultFrameSchema>;
export const noCapabilities: CapabilitySet = {
  observe: false,
  history: false,
  prompt: false,
  interrupt: false,
  permission: false,
  terminalSnapshot: false,
};
