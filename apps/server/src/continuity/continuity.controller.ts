import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ContinuityLocalRequestKind,
  ErrorCode,
  HandoffPhase,
  HttpStatus,
  continuityApproveRequestSchema,
  continuityConversationRequestSchema,
  continuityInspectRequestSchema,
  continuityListLinksRequestSchema,
  continuityOperationRequestSchema,
  continuityPrepareRequestSchema,
  continuitySourceInspectionSchema,
  startHandoffRequestSchema,
} from '@protocol';
import type { Request } from 'express';
import { AuthService } from '../auth/auth-service.js';
import type { Principal } from '../auth/security.js';
import { CommandDispatcher } from '../commands/command-dispatcher.js';
import { DeviceService } from '../devices/service.js';
import { bearer } from '../http/auth/bearer.js';
import { CurrentPrincipal } from '../http/auth/current-principal.js';
import { PrincipalGuard } from '../http/auth/principal.guard.js';
import { Fault } from '../http/errors/fault.js';
import { ContinuityProxy } from './proxy.js';
import { ContinuityService } from './service.js';

/** Conversation continuity: inspecting a device's sessions, linking executions, checkpoints and handoffs. */
@Controller()
@UseGuards(PrincipalGuard)
export class ContinuityController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(ContinuityService) private readonly continuity: ContinuityService,
    @Inject(ContinuityProxy) private readonly proxy: ContinuityProxy,
    @Inject(CommandDispatcher) private readonly dispatcher: CommandDispatcher,
  ) {}

  @Post('devices/:deviceId/continuity/sessions/:sessionId/inspect')
  @HttpCode(HttpStatus.Ok)
  async inspectSession(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = continuityInspectRequestSchema.parse(body);

    if (input.deviceId !== deviceId || input.sessionId !== sessionId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return this.inspect(p, deviceId, input.sessionId, input.generation, () => this.authorize(req));
  }

  @Post('devices/:deviceId/continuity/conversations')
  @HttpCode(HttpStatus.Ok)
  async createConversation(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { continuity } = this;
    const input = continuityConversationRequestSchema.parse(body);

    if (input.deviceId !== deviceId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    const result = await this.inspect(p, deviceId, input.sessionId, input.generation, () =>
      this.authorize(req),
    );

    if (
      !result.source.supported ||
      !result.source.provider ||
      !result.source.profileId ||
      !result.source.mode
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (result.conversation) {
      return continuity.listLinks(p, await this.scope(p, deviceId), result.conversation.id);
    }

    await continuity.createConversation(p, await this.scope(p, deviceId), {
      conversationId: input.conversationId,
      id: randomUUID(),
      provider: result.source.provider,
      profileId: result.source.profileId,
      mode: result.source.mode,
      nativeSessionId: result.source.sessionId,
      generation: result.source.generation,
    });

    return continuity.listLinks(p, await this.scope(p, deviceId), input.conversationId);
  }

  @Get('devices/:deviceId/continuity/conversations/:conversationId/executions')
  async listExecutions(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const input = continuityListLinksRequestSchema.parse({ deviceId, conversationId });

    if (input.deviceId !== deviceId || input.conversationId !== conversationId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return this.continuity.listLinks(p, await this.scope(p, deviceId), conversationId);
  }

  @Post('devices/:deviceId/continuity/checkpoints/prepare')
  @HttpCode(HttpStatus.Ok)
  async prepareCheckpoint(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = continuityPrepareRequestSchema.parse(body);

    if (input.deviceId !== deviceId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return this.proxy.request(p, input.deviceId, input, () => this.authorize(req));
  }

  @Post('devices/:deviceId/continuity/checkpoints/:checkpointId/approve')
  @HttpCode(HttpStatus.Ok)
  async approveCheckpoint(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Param('checkpointId') checkpointId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = continuityApproveRequestSchema.parse(body);

    if (input.deviceId !== deviceId || input.checkpointId !== checkpointId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return this.proxy.request(p, input.deviceId, input, () => this.authorize(req));
  }

  @Post('continuity/handoffs')
  @HttpCode(HttpStatus.Ok)
  async startHandoff(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    const { continuity } = this;
    const input = startHandoffRequestSchema.parse(body);
    const device = await this.devices.owned(p, input.request.deviceId);

    if (input.request.ownerId !== p.userId) {
      throw new Fault(ErrorCode.ACCESS_DENIED);
    }

    const operation = await continuity.startHandoff(
      p,
      {
        deviceId: device.id,
        deviceGeneration: device.generation,
      },
      input,
    );

    if (operation.phase === HandoffPhase.CreatingTarget) {
      await this.dispatcher.dispatchHandoffCreate(p, operation.id);
    }

    return continuity.getHandoff(
      p,
      { deviceId: device.id, deviceGeneration: device.generation },
      operation.id,
    );
  }

  @Get('devices/:deviceId/continuity/handoffs/:operationId')
  async getHandoff(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Param('operationId') operationId: string,
  ) {
    const input = continuityOperationRequestSchema.parse({ deviceId, operationId });

    if (input.deviceId !== deviceId || input.operationId !== operationId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return this.continuity.getHandoff(p, await this.scope(p, input.deviceId), input.operationId);
  }

  @Post('devices/:deviceId/continuity/handoffs/:operationId/reconcile')
  @HttpCode(HttpStatus.Ok)
  async reconcileHandoff(
    @CurrentPrincipal() p: Principal,
    @Param('deviceId') deviceId: string,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    const { continuity } = this;
    const input = continuityOperationRequestSchema.parse(body);

    if (input.deviceId !== deviceId || input.operationId !== operationId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    const currentScope = await this.scope(p, input.deviceId);
    const operation = await continuity.getHandoff(p, currentScope, input.operationId);

    if (operation.phase === HandoffPhase.CreatingTarget) {
      await this.dispatcher.dispatchHandoffCreate(p, operation.id);
    }

    return continuity.getHandoff(p, currentScope, operation.id);
  }

  // Re-checks the caller's token while a device request is pending.
  private async authorize(req: Request) {
    await this.auth.authenticate(bearer(req));
  }

  private async scope(p: Principal, deviceId: string) {
    const device = await this.devices.owned(p, deviceId);

    return { deviceId: device.id, deviceGeneration: device.generation };
  }

  private async inspect(
    p: Principal,
    deviceId: string,
    sessionId: string,
    generation: string,
    authorizeRequest: () => Promise<void>,
  ) {
    const local = await this.proxy.request(
      p,
      deviceId,
      { kind: ContinuityLocalRequestKind.InspectSource, sessionId, generation },
      authorizeRequest,
    );

    if (local.kind !== ContinuityLocalRequestKind.InspectSource) {
      throw new Fault(ErrorCode.INVALID_FRAME);
    }

    const source = continuitySourceInspectionSchema.parse(local.data);

    const existing = await this.continuity.inspectSource(
      p,
      await this.scope(p, deviceId),
      sessionId,
      generation,
    );

    return { source, ...existing };
  }
}
