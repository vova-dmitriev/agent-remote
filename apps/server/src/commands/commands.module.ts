import { Module } from '@nestjs/common';
import { Database } from '../db/database.js';
import { CommandDispatcher } from './command-dispatcher.js';
import { CommandsController } from './commands.controller.js';
import { CommandRepository } from './repositories/audit.js';

@Module({
  controllers: [CommandsController],
  providers: [
    {
      provide: CommandRepository,
      inject: [Database],
      useFactory: (db: Database) => new CommandRepository(db),
    },
    CommandDispatcher,
  ],
  exports: [CommandRepository, CommandDispatcher],
})
export class CommandsModule {}
