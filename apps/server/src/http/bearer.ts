import { ErrorCode } from '@protocol';
import type { IncomingMessage } from 'node:http';
import { Fault } from './fault.js';

const BEARER_PREFIX = 'Bearer ';
const MAX_AUTHORIZATION_LENGTH = 520;

export const bearer = (req: Pick<IncomingMessage, 'headers'>) => {
  const value = req.headers.authorization;

  if (!value?.startsWith(BEARER_PREFIX) || value.length > MAX_AUTHORIZATION_LENGTH) {
    throw new Fault(ErrorCode.UNAUTHORIZED);
  }

  return value.slice(BEARER_PREFIX.length);
};
