import { z } from 'zod';
import { executionProfileSummarySchema } from '@protocol';
import type { ProfileScope } from '../types.js';

const fields = executionProfileSummarySchema.shape;
const scopeSchema = z.strictObject({ ownerId: fields.ownerId, deviceId: fields.deviceId });

export function immutableProfileScope(scope: ProfileScope): ProfileScope {
  return Object.freeze(scopeSchema.parse(scope));
}
