import {
  ErrorCode,
  HttpRequestMethod,
  ContinuityLocalRequestKind,
  continuityInspectRequestSchema,
  continuityInspectionSchema,
  continuityConversationRequestSchema,
  continuityListLinksRequestSchema,
  continuityLinksSchema,
  continuityPrepareRequestSchema,
  continuityApproveRequestSchema,
  continuityLocalResponseSchema,
  continuityOperationRequestSchema,
  handoffOperationSchema,
  startHandoffRequestSchema,
  type ContinuityAccess,
  type ContinuityInspectRequest,
  type ContinuityConversationRequest,
  type ContinuityListLinksRequest,
  type ContinuityPrepareRequest,
  type ContinuityApproveRequest,
  type ContinuityOperationRequest,
  type StartHandoffRequest,
  type HandoffOperation,
} from '../../protocol/src/index.js';
import { ContinuityClientScope } from './continuity-client-scope.js';
import { validateContinuityLinks } from './continuity-client-validation.js';

export class BoundContinuityClient extends ContinuityClientScope implements ContinuityAccess {
  async inspect(raw: ContinuityInspectRequest) {
    const input = continuityInspectRequestSchema.parse(raw);

    const result = await this.request(
      input.deviceId,
      HttpRequestMethod.Post,
      `${this.base}/sessions/${encodeURIComponent(input.sessionId)}/inspect`,
      continuityInspectionSchema,
      input,
    );

    if (result.source.sessionId !== input.sessionId || result.source.generation !== input.generation) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    for (const record of [result.conversation, result.sourceExecution, result.pendingHandoff]) {
      if (record) {
        this.assertCurrent(record.deviceId);
      }
    }

    return result;
  }

  async createConversation(raw: ContinuityConversationRequest) {
    const input = continuityConversationRequestSchema.parse(raw);

    const result = await this.request(
      input.deviceId,
      HttpRequestMethod.Post,
      `${this.base}/conversations`,
      continuityLinksSchema,
      input,
    );

    return validateContinuityLinks(result, input.conversationId, (deviceId) => this.assertCurrent(deviceId));
  }

  async listLinks(raw: ContinuityListLinksRequest) {
    const input = continuityListLinksRequestSchema.parse(raw);

    const result = await this.request(
      input.deviceId,
      HttpRequestMethod.Get,
      `${this.base}/conversations/${encodeURIComponent(input.conversationId)}/executions`,
      continuityLinksSchema,
    );

    return validateContinuityLinks(result, input.conversationId, (deviceId) => this.assertCurrent(deviceId));
  }

  async prepareCheckpoint(raw: ContinuityPrepareRequest) {
    const input = continuityPrepareRequestSchema.parse(raw);

    const result = await this.request(
      input.deviceId,
      HttpRequestMethod.Post,
      `${this.base}/checkpoints/prepare`,
      continuityLocalResponseSchema,
      input,
    );

    if (
      result.kind !== ContinuityLocalRequestKind.PrepareCheckpoint ||
      result.data.draft.sourceExecutionId !== input.executionId
    ) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    return result;
  }

  async approveCheckpoint(raw: ContinuityApproveRequest) {
    const input = continuityApproveRequestSchema.parse(raw);

    const result = await this.request(
      input.deviceId,
      HttpRequestMethod.Post,
      `${this.base}/checkpoints/${encodeURIComponent(input.checkpointId)}/approve`,
      continuityLocalResponseSchema,
      input,
    );

    if (
      result.kind !== ContinuityLocalRequestKind.ApproveCheckpoint ||
      result.data.id !== input.checkpointId ||
      result.data.sourceGeneration !== input.generation
    ) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    return result;
  }

  async startHandoff(raw: StartHandoffRequest) {
    const input = startHandoffRequestSchema.parse(raw);

    const result = await this.request(
      input.request.deviceId,
      HttpRequestMethod.Post,
      '/continuity/handoffs',
      handoffOperationSchema,
      input,
    );

    if (
      result.id !== input.operationId ||
      Object.entries(input.request).some(
        ([key, value]) => JSON.stringify(result[key as keyof HandoffOperation]) !== JSON.stringify(value),
      )
    ) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    return result;
  }

  private async operation(raw: ContinuityOperationRequest, reconcile: boolean) {
    const input = continuityOperationRequestSchema.parse(raw);
    const path = `${this.base}/handoffs/${encodeURIComponent(input.operationId)}`;

    const result = await this.request(
      input.deviceId,
      reconcile ? HttpRequestMethod.Post : HttpRequestMethod.Get,
      path + (reconcile ? '/reconcile' : ''),
      handoffOperationSchema,
      reconcile ? input : undefined,
    );

    this.assertCurrent(result.deviceId);

    if (result.id !== input.operationId) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    return result;
  }

  getHandoff(input: ContinuityOperationRequest) {
    return this.operation(input, false);
  }

  reconcileHandoff(input: ContinuityOperationRequest) {
    return this.operation(input, true);
  }
}
