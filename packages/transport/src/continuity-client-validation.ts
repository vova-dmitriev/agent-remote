import { ErrorCode, type ContinuityLinks } from '@protocol';

export function validateContinuityLinks(
  result: ContinuityLinks,
  conversationId: string,
  assertDevice: (deviceId: string) => void,
) {
  assertDevice(result.conversation.deviceId);

  if (result.conversation.id !== conversationId) {
    throw new Error(ErrorCode.INVALID_FRAME);
  }

  for (const record of [...result.executions, ...(result.pendingHandoff ? [result.pendingHandoff] : [])]) {
    assertDevice(record.deviceId);

    if (record.conversationId !== conversationId || record.ownerId !== result.conversation.ownerId) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }
  }

  return result;
}
