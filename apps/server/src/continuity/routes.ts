import { randomUUID } from 'node:crypto';
import {
  ContinuityLocalRequestKind,
  ErrorCode,
  HandoffPhase,
  continuityApproveRequestSchema,
  continuityConversationRequestSchema,
  continuityInspectRequestSchema,
  continuityListLinksRequestSchema,
  continuityOperationRequestSchema,
  continuityPrepareRequestSchema,
  continuitySourceInspectionSchema,
  startHandoffRequestSchema,
} from '@protocol';
import { type Principal } from '../auth/security.js';
import { Fault } from '../http/fault.js';
import type { DeviceService } from '../devices/service.js';
import { HttpMethod } from '../domain/http.js';
import type { Request } from 'express';
import type { ContinuityProxy } from './proxy.js';
import type { ContinuityService } from './service.js';

type Route = (method: HttpMethod, path: string, handler: (request: Request) => Promise<unknown>) => void;

export function mountContinuityRoutes(
  route: Route,
  principal: (request: Request) => Promise<Principal>,
  authorize: (request: Request) => Promise<void>,
  devices: Pick<DeviceService, 'owned'>,
  continuity: ContinuityService,
  proxy: ContinuityProxy,
  dispatchHandoffCreate: (principal: Principal, operationId: string) => Promise<unknown>,
) {
  const scope = async (p: Principal, deviceId: string) => {
    const device = await devices.owned(p, deviceId);

    return { deviceId: device.id, deviceGeneration: device.generation };
  };

  const inspect = async (
    p: Principal,
    deviceId: string,
    sessionId: string,
    generation: string,
    authorizeRequest: () => Promise<void>,
  ) => {
    const local = await proxy.request(
      p,
      deviceId,
      { kind: ContinuityLocalRequestKind.InspectSource, sessionId, generation },
      authorizeRequest,
    );

    if (local.kind !== ContinuityLocalRequestKind.InspectSource) {
      throw new Fault(ErrorCode.INVALID_FRAME);
    }

    const source = continuitySourceInspectionSchema.parse(local.data);
    const existing = await continuity.inspectSource(p, await scope(p, deviceId), sessionId, generation);

    return { source, ...existing };
  };

  route(HttpMethod.Post, '/devices/:deviceId/continuity/sessions/:sessionId/inspect', async (request) => {
    const p = await principal(request);
    const deviceId = String(request.params.deviceId);
    const input = continuityInspectRequestSchema.parse(request.body);

    if (input.deviceId !== deviceId || input.sessionId !== request.params.sessionId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return inspect(p, deviceId, input.sessionId, input.generation, () => authorize(request));
  });

  route(HttpMethod.Post, '/devices/:deviceId/continuity/conversations', async (request) => {
    const p = await principal(request);
    const deviceId = String(request.params.deviceId);
    const input = continuityConversationRequestSchema.parse(request.body);

    if (input.deviceId !== deviceId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    const result = await inspect(p, deviceId, input.sessionId, input.generation, () => authorize(request));

    if (
      !result.source.supported ||
      !result.source.provider ||
      !result.source.profileId ||
      !result.source.mode
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (result.conversation) {
      return continuity.listLinks(p, await scope(p, deviceId), result.conversation.id);
    }

    await continuity.createConversation(p, await scope(p, deviceId), {
      conversationId: input.conversationId,
      id: randomUUID(),
      provider: result.source.provider,
      profileId: result.source.profileId,
      mode: result.source.mode,
      nativeSessionId: result.source.sessionId,
      generation: result.source.generation,
    });

    return continuity.listLinks(p, await scope(p, deviceId), input.conversationId);
  });

  route(
    HttpMethod.Get,
    '/devices/:deviceId/continuity/conversations/:conversationId/executions',
    async (request) => {
      const p = await principal(request);
      const deviceId = String(request.params.deviceId);
      const conversationId = String(request.params.conversationId);
      const input = continuityListLinksRequestSchema.parse({ deviceId, conversationId });

      if (input.deviceId !== deviceId || input.conversationId !== conversationId) {
        throw new Fault(ErrorCode.INVALID_REQUEST);
      }

      return continuity.listLinks(p, await scope(p, deviceId), conversationId);
    },
  );

  route(HttpMethod.Post, '/devices/:deviceId/continuity/checkpoints/prepare', async (request) => {
    const p = await principal(request);
    const input = continuityPrepareRequestSchema.parse(request.body);

    if (input.deviceId !== request.params.deviceId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return proxy.request(p, input.deviceId, input, () => authorize(request));
  });

  route(
    HttpMethod.Post,
    '/devices/:deviceId/continuity/checkpoints/:checkpointId/approve',
    async (request) => {
      const p = await principal(request);
      const input = continuityApproveRequestSchema.parse(request.body);

      if (input.deviceId !== request.params.deviceId || input.checkpointId !== request.params.checkpointId) {
        throw new Fault(ErrorCode.INVALID_REQUEST);
      }

      return proxy.request(p, input.deviceId, input, () => authorize(request));
    },
  );

  route(HttpMethod.Post, '/continuity/handoffs', async (request) => {
    const p = await principal(request);
    const input = startHandoffRequestSchema.parse(request.body);
    const device = await devices.owned(p, input.request.deviceId);

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
      await dispatchHandoffCreate(p, operation.id);
    }

    return continuity.getHandoff(
      p,
      { deviceId: device.id, deviceGeneration: device.generation },
      operation.id,
    );
  });

  route(HttpMethod.Get, '/devices/:deviceId/continuity/handoffs/:operationId', async (request) => {
    const p = await principal(request);

    const input = continuityOperationRequestSchema.parse({
      deviceId: request.params.deviceId,
      operationId: request.params.operationId,
    });

    if (input.deviceId !== request.params.deviceId || input.operationId !== request.params.operationId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    return continuity.getHandoff(p, await scope(p, input.deviceId), input.operationId);
  });

  route(HttpMethod.Post, '/devices/:deviceId/continuity/handoffs/:operationId/reconcile', async (request) => {
    const p = await principal(request);
    const input = continuityOperationRequestSchema.parse(request.body);

    if (input.deviceId !== request.params.deviceId || input.operationId !== request.params.operationId) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    const currentScope = await scope(p, input.deviceId);
    const operation = await continuity.getHandoff(p, currentScope, input.operationId);

    if (operation.phase === HandoffPhase.CreatingTarget) {
      await dispatchHandoffCreate(p, operation.id);
    }

    return continuity.getHandoff(p, currentScope, operation.id);
  });
}
