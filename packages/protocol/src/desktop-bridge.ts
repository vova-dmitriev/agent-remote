import { z } from 'zod';
import { LOCAL_LIMITS } from './local-limits.js';
import { localActionSchema } from './local-client.js';
import { LocalOperation } from './values/local-client.js';
import { serverFrameSchema } from './schemas.js';
import { DesktopBridgeKind, DesktopBridgeVersion } from './values/desktop-bridge.js';

const id = z.uuid();
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const version = z.literal(DesktopBridgeVersion.V1);
const mediaChunkEncodedLimit = Math.ceil(LOCAL_LIMITS.chunkBytes / 3) * 4;
const strictBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export const desktopMediaChunkDataSchema = z.string().superRefine((data, context) => {
  if (data.length > mediaChunkEncodedLimit) {
    context.addIssue({ code: 'custom', message: 'INVALID_DESKTOP_CHUNK' });

    return;
  }

  if (!data.length || data.length % 4 !== 0 || !strictBase64Pattern.test(data)) {
    context.addIssue({ code: 'custom', message: 'INVALID_DESKTOP_CHUNK' });

    return;
  }

  if (atob(data).length > LOCAL_LIMITS.chunkBytes) {
    context.addIssue({ code: 'custom', message: 'INVALID_DESKTOP_CHUNK' });
  }
});

const actionSchema = localActionSchema.superRefine((action, context) => {
  if (action.operation !== LocalOperation.MediaChunk) {
    return;
  }

  if (!desktopMediaChunkDataSchema.safeParse(action.data).success) {
    context.addIssue({ code: 'custom', message: 'INVALID_DESKTOP_CHUNK', path: ['data'] });
  }
});

export const desktopBridgeLeaseSchema = z.strictObject({ leaseId: id, epoch });

export const desktopBridgeRequestSchema = z.strictObject({
  kind: z.literal(DesktopBridgeKind.Request),
  version,
  requestId: id,
  leaseId: id,
  epoch,
  action: actionSchema,
});

export const desktopBridgeEventSchema = z.strictObject({
  kind: z.literal(DesktopBridgeKind.Event),
  version,
  leaseId: id,
  epoch,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  frame: serverFrameSchema,
});

export const desktopBridgeAcknowledgeSchema = z.strictObject({
  leaseId: id,
  epoch,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const desktopBridgeResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    kind: z.literal(DesktopBridgeKind.Result),
    version,
    requestId: id,
    leaseId: id,
    epoch,
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.strictObject({
    kind: z.literal(DesktopBridgeKind.Result),
    version,
    requestId: id,
    leaseId: id,
    epoch,
    ok: z.literal(false),
    code: z.string().min(1).max(512),
  }),
]);

export type DesktopBridgeLease = z.infer<typeof desktopBridgeLeaseSchema>;
export type DesktopBridgeRequest = z.infer<typeof desktopBridgeRequestSchema>;
export type DesktopBridgeEvent = z.infer<typeof desktopBridgeEventSchema>;
export type DesktopBridgeAcknowledge = z.infer<typeof desktopBridgeAcknowledgeSchema>;
export type DesktopBridgeResult = z.infer<typeof desktopBridgeResultSchema>;

/** Fixed preload capabilities; no raw IPC channel, URL, path, or local grant token crosses this API. */
export interface DesktopBridge {
  open(): Promise<DesktopBridgeLease>;
  request(request: DesktopBridgeRequest): Promise<DesktopBridgeResult>;
  subscribe(listener: (event: DesktopBridgeEvent) => void): () => void;
  close(leaseId: string, epoch: number): Promise<void>;
}
