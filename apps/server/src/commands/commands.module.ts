import { Module } from '@nestjs/common';
import { CommandDispatcher } from './command-dispatcher.js';
import { CommandsController } from './commands.controller.js';

@Module({
  controllers: [CommandsController],
  providers: [CommandDispatcher],
  exports: [CommandDispatcher],
})
export class CommandsModule {}
