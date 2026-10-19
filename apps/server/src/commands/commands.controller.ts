import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ErrorCode, HttpStatus, clientCommandSchema } from '@protocol';
import type { Principal } from '../auth/security.js';
import { Database } from '../db/database.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { CommandDispatcher } from './command-dispatcher.js';

/** Sends a client command over HTTP and reports a recorded command's outcome. */
@Controller('commands')
@UseGuards(PrincipalGuard)
export class CommandsController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CommandDispatcher) private readonly dispatcher: CommandDispatcher,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Ok)
  async send(@CurrentPrincipal() p: Principal, @Body() input: unknown) {
    return this.dispatcher.command(p, clientCommandSchema.parse(input));
  }

  @Get(':id')
  async status(@CurrentPrincipal() p: Principal, @Param('id') commandId: string) {
    const { db } = this;

    const row = (
      await db.pool.query(
        'SELECT command_id AS "commandId",status,code,result_session_id AS "sessionId" FROM command_audit WHERE owner_id=$1 AND command_id=$2',
        [p.userId, commandId],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (row.sessionId === null) {
      delete row.sessionId;
    }

    return row;
  }
}
