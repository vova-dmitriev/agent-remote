import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ErrorCode, HttpStatus } from '@protocol';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import { bearer } from '../http/auth/bearer.js';
import { Fault } from '../http/errors/fault.js';
import { AuthService } from './auth-service.js';
import { BrowserSessions, readRefreshCookie, refreshCookie } from './sessions/browser-sessions.js';
import { Limiter, RateLimitKey, telegramIdentity } from './security.js';
import { SessionRevocations } from './sessions/session-revocations.js';

const REFRESH_IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BrowserSessions) private readonly browserSessions: BrowserSessions,
    @Inject(Limiter) private readonly limiter: Limiter,
    @Inject(SessionRevocations) private readonly revocations: SessionRevocations,
  ) {
    this.secureCookie = new URL(config.publicOrigin).protocol === 'https:';
  }

  @Post('telegram')
  @HttpCode(HttpStatus.Ok)
  async telegram(@Req() req: Request, @Body() input: unknown, @Res({ passthrough: true }) res: Response) {
    this.limiter.take(RateLimitKey.Auth + req.ip, 10);
    const body = z.strictObject({ initData: z.string().max(16384) }).parse(input);
    const login = await this.auth.login(body.initData);
    const browser = await this.browserSessions.create(login.token);

    res.setHeader(
      'Set-Cookie',
      refreshCookie(browser.secret, this.secureCookie, Math.floor((browser.expiresAt - Date.now()) / 1000)),
    );

    return login;
  }

  /** A short code the signed-in owner types into another client (the Chrome extension) to link it once. */
  @Post('link-code')
  @HttpCode(HttpStatus.Ok)
  async linkCode(@Req() req: Request) {
    const principal = await this.auth.authenticate(bearer(req));

    this.limiter.take(RateLimitKey.LinkCode + principal.userId, 10);

    return this.auth.linkCode(principal.userId);
  }

  /**
   * Links a client by its code: an access token, and a refresh credential it keeps itself (no cookie: an extension
   * is not the public origin). The credential renews access through `/auth/refresh` and is revoked by logout.
   */
  @Post('link')
  @HttpCode(HttpStatus.Ok)
  async link(@Req() req: Request, @Body() input: unknown) {
    this.limiter.take(RateLimitKey.Link + req.ip, 10);
    const body = z.strictObject({ code: z.string().min(1).max(32) }).parse(input);
    const login = await this.auth.redeemLink(body.code);
    const browser = await this.browserSessions.create(login.token);

    return { ...login, refresh: browser.secret };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.Ok)
  async refresh(@Req() req: Request, @Body() input: unknown) {
    const body = z
      .strictObject({ initData: z.string().max(16384).optional(), refresh: z.string().max(128).optional() })
      .parse(input ?? {});

    // A credential in the body cannot be sent by another site; the cookie can, so it needs the public origin.
    if (body.refresh === undefined && req.headers.origin !== this.config.publicOrigin) {
      throw new Fault(ErrorCode.ACCESS_DENIED);
    }

    this.limiter.take(RateLimitKey.Refresh + req.ip, 30);

    const expected =
      body.initData === undefined
        ? undefined
        : telegramIdentity(body.initData, this.config.botToken, Date.now(), REFRESH_IDENTITY_MAX_AGE_MS);

    return this.browserSessions.refresh(
      body.refresh ?? readRefreshCookie(req.headers.cookie),
      Date.now(),
      expected,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.Ok)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', refreshCookie('', this.secureCookie, 0));
    let revoked: string[];

    try {
      const token = bearer(req);

      await this.auth.authenticate(token);
      revoked = await this.auth.logout(token);
    } catch (error) {
      if (
        !(error instanceof Fault) ||
        error.code !== ErrorCode.UNAUTHORIZED ||
        req.headers.origin !== this.config.publicOrigin
      ) {
        throw error;
      }

      revoked = await this.browserSessions.revoke(readRefreshCookie(req.headers.cookie));
    }

    this.revocations.publish(revoked);

    return {};
  }
}
