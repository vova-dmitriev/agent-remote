import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ErrorCode, HttpStatus } from '@protocol';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import { DeviceService } from '../devices/service.js';
import { bearer } from '../http/auth/bearer.js';
import { Fault } from '../http/errors/fault.js';

/** Whether two secrets are equal, in time that does not depend on where they differ. */
const sameSecret = (given: string, expected: string) =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  );

/**
 * A shared VM's supervisor, authenticated by the operator token: it is given a device for every user who opened
 * the app without one, and runs that user's daemon with it. The app's tokens never reach this endpoint.
 */
@Controller('operator')
export class OperatorController {
  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(DeviceService) private readonly devices: DeviceService,
  ) {}

  @Post('devices')
  @HttpCode(HttpStatus.Ok)
  async provision(@Req() request: Request) {
    const expected = this.config.operatorToken;

    // Off unless the relay was started with an operator token: it does not exist for anyone.
    if (!expected) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (!sameSecret(bearer(request), expected)) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    return { devices: await this.devices.provisionAll() };
  }
}
