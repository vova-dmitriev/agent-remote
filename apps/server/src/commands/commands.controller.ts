import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ErrorCode, HttpStatus, clientCommandSchema } from '@protocol';
import type { Principal } from '../auth/security.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { CommandDispatcher } from './command-dispatcher.js';
import { CommandRepository } from './repositories/audit.js';

/** Sends a client command over HTTP and reports a recorded command's outcome. */
@Controller('commands')
@UseGuards(PrincipalGuard)
export class CommandsController {
  constructor(
    @Inject(CommandRepository) private readonly commands: CommandRepository,
    @Inject(CommandDispatcher) private readonly dispatcher: CommandDispatcher,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Ok)
  async send(@CurrentPrincipal() p: Principal, @Body() input: unknown) {
    return this.dispatcher.command(p, clientCommandSchema.parse(input));
  }

  @Get(':id')
  async status(@CurrentPrincipal() p: Principal, @Param('id') commandId: string) {
    const row = await this.commands.status(p.userId, commandId);

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    const { sessionId, ...status } = row;

    return sessionId === null ? status : { ...status, sessionId };
  }
}
