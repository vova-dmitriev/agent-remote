import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth-service.js';
import { bearer } from './bearer.js';
import { rememberPrincipal } from './current-principal.js';

/** Authenticates the bearer token; rejects with `UNAUTHORIZED` through `FaultFilter`. */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();

    rememberPrincipal(request, await this.auth.authenticate(bearer(request)));

    return true;
  }
}
