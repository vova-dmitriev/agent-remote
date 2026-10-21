import { z } from 'zod';
import { FrameType } from '../connection/values.js';
import { ErrorCode } from '../errors/error-codes.js';
import { sessionSkillsSchema } from './schemas.js';

const id = z.string().min(1).max(512);

export const skillsRequestFrameSchema = z.strictObject({
  type: z.literal(FrameType.SkillsRequest),
  requestId: z.uuid(),
  sessionId: id,
  generation: id,
});

export const skillsResultFrameSchema = z.strictObject({
  type: z.literal(FrameType.SkillsResult),
  requestId: z.uuid(),
  reply: z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), skills: sessionSkillsSchema }),
    z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
  ]),
});
