import {
  ErrorCode,
  ProviderFilterValue,
  SessionListLimits,
  type ProviderFilterValue as Provider,
} from '@protocol';
import { z } from 'zod';
import { Fault } from '../../http/errors/fault.js';

const cursorSchema = z.strictObject({
  ownerId: z.string().min(1).max(512),
  deviceId: z.string().min(1).max(512),
  generation: z.string().min(1).max(512),
  provider: z.enum(ProviderFilterValue),
  cursor: z.string().max(SessionListLimits.DeviceCursorLength),
});

export function encodeCursor(value: z.infer<typeof cursorSchema>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor(
  value: string | undefined,
  ownerId: string,
  deviceId: string,
  generation: string,
  provider: Provider,
) {
  if (value === undefined) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(z.string().max(SessionListLimits.CursorLength).parse(value), 'base64url').toString('utf8'),
    );

    const cursor = cursorSchema.parse(decoded);

    if (
      cursor.ownerId !== ownerId ||
      cursor.deviceId !== deviceId ||
      cursor.generation !== generation ||
      cursor.provider !== provider
    ) {
      throw new Error();
    }

    return cursor.cursor;
  } catch {
    throw new Fault(ErrorCode.INVALID_CURSOR);
  }
}
