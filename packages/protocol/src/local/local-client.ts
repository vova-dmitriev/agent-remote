import { z } from 'zod';
import { clientCommandSchema, serverFrameSchema } from '../session/schemas.js';
import { readingPositionSchema } from '../history/reading-position.js';
import { preferencePatchSchema } from '../history/preferences.js';
import { HistoryCursorPrefix, HistoryDirection } from '../history/values.js';
import { LocalKind, LocalOperation } from './client-values.js';
import { LOCAL_LIMITS } from './local-limits.js';
import { MAX_ATTACHMENT_BYTES, attachmentsSchema } from '../history/attachments.js';
import { profileRequestSchema } from '../profile/profile-access.js';
import { subagentIdSchema } from '../session/subagents.js';

const id = z.string().min(1).max(512);
const attachmentId = z.uuid();
const session = { sessionId: id };
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const transfer = { transferId: id };
const offset = z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES);
const operation = <T extends LocalOperation>(value: T) => ({ operation: z.literal(value) });

export const localActionSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...operation(LocalOperation.Profiles), request: profileRequestSchema }),
  z.strictObject(operation(LocalOperation.Devices)),
  z.strictObject({ ...operation(LocalOperation.Select), sessionId: id.nullable() }),
  z.strictObject({
    ...operation(LocalOperation.History),
    ...session,
    generation: id,
    direction: z.enum(HistoryDirection),
    anchor: z.string().min(1).max(2048).optional(),
    position: z.string().min(1).max(2048).startsWith(HistoryCursorPrefix.Position).optional(),
    agentId: subagentIdSchema.optional(),
  }),
  z.strictObject({ ...operation(LocalOperation.Send), command: clientCommandSchema }),
  z.strictObject({ ...operation(LocalOperation.Receipt), commandId: id }),
  z.strictObject(operation(LocalOperation.PreferencesGet)),
  z.strictObject({ ...operation(LocalOperation.PreferencesSave), patch: preferencePatchSchema }),
  z.strictObject({
    ...operation(LocalOperation.Rename),
    ...session,
    generation: id,
    title: z.string().trim().min(1).max(512),
  }),
  z.strictObject({ ...operation(LocalOperation.ReadingGet), ...session }),
  z.strictObject({
    ...operation(LocalOperation.ReadingSave),
    ...session,
    position: readingPositionSchema,
    revision,
  }),
  z.strictObject(operation(LocalOperation.Logout)),
  z.strictObject({
    ...operation(LocalOperation.MediaBegin),
    ...session,
    generation: id,
    uploadId: z.uuid(),
    name: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(128),
    byteLength: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  }),
  z.strictObject({
    ...operation(LocalOperation.MediaChunk),
    ...transfer,
    offset,
    data: z
      .string()
      .min(1)
      .max(Math.ceil(LOCAL_LIMITS.chunkBytes / 3) * 4),
  }),
  z.strictObject({ ...operation(LocalOperation.MediaFinish), ...transfer }),
  z.strictObject({ ...operation(LocalOperation.MediaAbort), ...transfer }),
  z.strictObject({ ...operation(LocalOperation.MediaRead), ...session, attachmentId }),
  z.strictObject({ ...operation(LocalOperation.MediaReadChunk), ...transfer, offset }),
  z.strictObject({ ...operation(LocalOperation.DraftGet), ...session }),
  z.strictObject({
    ...operation(LocalOperation.DraftSave),
    ...session,
    generation: id,
    revision,
    text: z.string().max(100_000),
    attachments: attachmentsSchema,
  }),
  z.strictObject({ ...operation(LocalOperation.QueueGet), ...session }),
  z.strictObject({
    ...operation(LocalOperation.QueueSave),
    ...session,
    generation: id,
    revision,
    intents: z.array(clientCommandSchema).max(LOCAL_LIMITS.queueLimit),
  }),
]);

export const localRequestSchema = z.strictObject({
  kind: z.literal(LocalKind.Request),
  version: z.literal(LOCAL_LIMITS.protocolVersion),
  requestId: id,
  lease: id,
  action: localActionSchema,
});
export const localHelloSchema = z.strictObject({
  kind: z.literal(LocalKind.Hello),
  version: z.literal(LOCAL_LIMITS.protocolVersion),
  requestId: id,
  clientId: z.uuid(),
  handle: z.string().max(128).optional(),
});
export const localResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    kind: z.literal(LocalKind.Result),
    requestId: id,
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.strictObject({ kind: z.literal(LocalKind.Result), requestId: id, ok: z.literal(false), code: id }),
]);
export const localEventSchema = z.strictObject({
  kind: z.literal(LocalKind.Event),
  lease: id,
  frame: serverFrameSchema,
});
export const localGrantSchema = z.strictObject({ lease: id, handle: id, ownerId: id, deviceId: id });
export type LocalAction = z.infer<typeof localActionSchema>;
export type LocalClientRequest = z.infer<typeof localRequestSchema>;
export type LocalClientResponse = z.infer<typeof localResultSchema>;
export type LocalClientEvent = z.infer<typeof localEventSchema>;
export type LocalHello = z.infer<typeof localHelloSchema>;
export type LocalClientGrant = z.infer<typeof localGrantSchema>;
