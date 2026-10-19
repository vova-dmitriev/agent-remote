import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { ContinuityController } from './continuity.controller.js';

@Module({
  imports: [CommandsModule],
  controllers: [ContinuityController],
})
export class ContinuityModule {}
