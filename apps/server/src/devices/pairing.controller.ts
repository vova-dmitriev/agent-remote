import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { HttpStatus } from '@protocol';
import type { Request } from 'express';
import { z } from 'zod';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import { Limiter, RateLimitKey, type Principal } from '../auth/security.js';
import { CurrentPrincipal } from '../http/current-principal.js';
import { PrincipalGuard } from '../http/principal.guard.js';
import { DeviceService } from './service.js';

const boundedId = z.string().min(1).max(512);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const proofRequest = z.strictObject({ proof: boundedId });

/** Device pairing: the companion starts, polls and confirms; the signed-in user claims the code. */
@Controller()
export class PairingController {
  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(Limiter) private readonly limiter: Limiter,
  ) {}

  @Post('device/pair/start')
  @HttpCode(HttpStatus.Ok)
  async start(@Req() req: Request, @Body() input: unknown) {
    this.limiter.take(RateLimitKey.PairStart + req.ip, 5);
    const body = z.strictObject({ codeHash: sha, proofHash: sha }).parse(input);
    const result = await this.devices.start(body.codeHash, body.proofHash);

    return {
      ...result,
      ...(/^[A-Za-z0-9_]+$/.test(this.config.botUsername ?? '')
        ? { botUsername: this.config.botUsername }
        : {}),
    };
  }

  @Post('pair/claim')
  @HttpCode(HttpStatus.Ok)
  @UseGuards(PrincipalGuard)
  async claim(@Req() req: Request, @CurrentPrincipal() p: Principal, @Body() input: unknown) {
    this.limiter.take(RateLimitKey.PairIp + req.ip, 5);
    this.limiter.take(RateLimitKey.PairOwner + p.userId, 5);
    const body = z.strictObject({ code: boundedId }).parse(input);

    return this.devices.claim(p, body.code);
  }

  @Post('device/pair/cancel')
  @HttpCode(HttpStatus.Ok)
  async cancel(@Body() input: unknown) {
    return this.devices.cancel(proofRequest.parse(input).proof);
  }

  @Post('device/pair/status')
  @HttpCode(HttpStatus.Ok)
  async status(@Body() input: unknown) {
    return this.devices.status(proofRequest.parse(input).proof);
  }

  @Post('device/pair/confirm')
  @HttpCode(HttpStatus.Ok)
  async confirm(@Body() input: unknown) {
    const body = z.strictObject({ proof: boundedId, claimId: boundedId, approved: z.boolean() }).parse(input);

    // A declined pairing has no device; the relay has always answered it with an empty object.
    return (await this.devices.confirm(body.proof, body.claimId, body.approved)) ?? {};
  }
}
