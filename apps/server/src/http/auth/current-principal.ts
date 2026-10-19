import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@protocol';
import type { Request } from 'express';
import type { Principal } from '../../auth/security.js';
import { Fault } from '../errors/fault.js';

const principals = new WeakMap<Request, Principal>();

export const rememberPrincipal = (request: Request, principal: Principal) => {
  principals.set(request, principal);
};

/** The principal `PrincipalGuard` authenticated for this request. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const principal = principals.get(context.switchToHttp().getRequest<Request>());

  if (!principal) {
    throw new Fault(ErrorCode.UNAUTHORIZED);
  }

  return principal;
});
