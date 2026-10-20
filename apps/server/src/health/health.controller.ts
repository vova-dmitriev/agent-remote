import { Controller, Get, Inject } from '@nestjs/common';
import { HealthStatus } from '../domain/infrastructure.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { MESSAGING } from '../app/relay-config.js';
import { HealthRepository } from './repository.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthRepository) private readonly storage: HealthRepository,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
  ) {}

  @Get()
  async health() {
    await this.storage.ping();
    await this.messaging?.health();

    return { status: HealthStatus.Ok };
  }
}
