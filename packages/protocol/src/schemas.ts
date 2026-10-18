import {
  AgentProvider,
  AttachmentMode,
  BindingState,
  CommandActionType,
  CommandStatus,
  PromptDelivery,
  ConnectorTransport,
  DeviceStatus,
  FrameType,
  IntegrationState,
  MessageRole,
  NativeRestartState,
  RemotePermissionDecision,
  SessionStatus,
  StatusConfidence,
  TargetKind,
} from './values/index.js';
import { ErrorCode } from './error-codes.js';
import { z } from 'zod';
import { sessionChangesSchema } from './file-changes.js';
import { sessionActivitySchema } from './activity.js';
import { historyReadSchema, historyDoneSchema } from './history-window.js';
import { subagentSchema } from './subagents.js';
import { validatePrompt } from './validation.js';
import { attachmentsSchema } from './attachments.js';
import { pendingUserInputSchema, userInputAnswersSchema } from './user-input.js';
import { profileRequestSchema, profileReplySchema } from './profile-access.js';
import { executionLaunchSelectionSchema } from './execution-profile.js';
import { executionVersionSchema } from './execution-fields.js';

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
export const capabilitySchema = z.strictObject({
  observe: z.boolean(),
  history: z.boolean(),
  historyWindow: z.boolean().optional(),
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
    subagents: z.array(subagentSchema).max(50).optional(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(256)
      // eslint-disable-next-line no-control-regex -- Intentionally reject control characters at the wire boundary.
      .regex(/^[^\u0000-\u001f\u007f<>]+$/u)
      .optional(),
    errorCode: z
      .enum([
        ErrorCode.CODEX_MODEL_UNAVAILABLE,
        ErrorCode.CODEX_AUTH_REQUIRED,
        ErrorCode.CODEX_NETWORK_ERROR,
        ErrorCode.CODEX_TURN_FAILED,
      ])
      .optional(),
    target: targetSchema,
    claudeSessionId: id.nullable(),
    generation: id,
    status: statusSchema,
    binding: z.enum(BindingState),
    lastEventAt: time,
    lastMessageAt: time.optional(),
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
    })
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
});
export const historySchema = z.strictObject({
  id,
  historyCursor: z.string().max(2048).optional(),
  role: z.enum(MessageRole),
  text: z.string().max(65_536),
  occurredAt: time,
  attachments: attachmentsSchema.optional(),
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
  sessions: z.array(sessionSchema).max(10),
  deviceStatus: z.enum(DeviceStatus),
  cursor: cursorSchema,
  permissions: z.array(permissionSchema).max(100),
  userInputs: z.array(pendingUserInputSchema).max(100).optional(),
  terminal: terminalSchema.nullable(),
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
export const deviceFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal(FrameType.ProfilesResult),
    requestId: z.uuid(),
    epoch: id,
    reply: profileReplySchema,
  }),
  historyDoneSchema,
  z.strictObject({
    type: z.literal(FrameType.HistoryItem),
    requestId: id,
    sessionId: id,
    generation: id,
    message: historySchema,
  }),
  z.strictObject({ type: z.literal(FrameType.Auth), token: id }),
  z.strictObject({ type: z.literal(FrameType.Heartbeat) }),
  z.strictObject({
    type: z.literal(FrameType.Snapshot),
    snapshot: snapshotSchema,
    connectors: z.array(connectorSchema).max(20),
  }),
  z.strictObject({ type: z.literal(FrameType.Event), event: eventSchema }),
  z.strictObject({ type: z.literal(FrameType.CommandResult), result: resultSchema }),
  handoffSeedProofFrameSchema,
]);
export const serverFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(FrameType.ProfilesCancel), requestId: z.uuid(), epoch: id }),
  z.strictObject({
    type: z.literal(FrameType.ProfilesRequest),
    requestId: z.uuid(),
    epoch: id,
    request: profileRequestSchema,
  }),
  historyReadSchema,
  z.strictObject({ type: z.literal(FrameType.Authenticated), epoch: id.optional() }),
  z.strictObject({
    type: z.literal(FrameType.Snapshot),
    deviceId: id,
    snapshot: snapshotSchema,
    connectors: z.array(connectorSchema).max(20),
  }),
  z.strictObject({ type: z.literal(FrameType.Event), event: eventSchema }),
  z.strictObject({ type: z.literal(FrameType.CommandResult), result: resultSchema }),
  z.strictObject({ type: z.literal(FrameType.ResyncRequired), deviceId: id }),
  z.strictObject({ type: z.literal(FrameType.DeviceStatus), deviceId: id, status: z.enum(DeviceStatus) }),
  z.strictObject({ type: z.literal(FrameType.Error), code: id }),
  z.strictObject({ type: z.literal(FrameType.Select), sessionId: id.nullable() }),
  z.strictObject({ type: z.literal(FrameType.Command), command: commandSchema }),
  z.strictObject({ type: z.literal(FrameType.Ack), cursor: cursorSchema }),
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
export const noCapabilities: CapabilitySet = {
  observe: false,
  history: false,
  prompt: false,
  interrupt: false,
  permission: false,
  terminalSnapshot: false,
};
