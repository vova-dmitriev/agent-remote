import { Controller, Get, Inject } from '@nestjs/common';
import { Database } from '../db/database.js';
import { HealthStatus } from '../domain/http.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { MESSAGING } from './core.module.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
  ) {}

  @Get()
  async health() {
    await this.db.pool.query('SELECT 1');
    await this.messaging?.health();

    return { status: HealthStatus.Ok };
  }
}
