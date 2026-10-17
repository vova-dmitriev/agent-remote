import { CodexMethod } from '../domain/codex.js';
import { SessionStatus, type Session } from '../../../../packages/protocol/src/index.js';
import { clearCurrentStep, currentToolStep } from '../monitor/current-step.js';
import { CODEX_TOOL_ITEM_TYPES } from './tool-item-type.js';
import { object } from './events.js';

export function codexCurrentStep(
  session: Session,
  method: string | undefined,
  params: Record<string, unknown>,
  activeTurn: string | null,
) {
  if (params.turnId !== activeTurn || !activeTurn) {
    return;
  }

  const item = object(params.item);

  if (typeof item.id !== 'string' || typeof item.type !== 'string' || !CODEX_TOOL_ITEM_TYPES.has(item.type)) {
    return;
  }

  if (method === CodexMethod.ItemStarted && session.status === SessionStatus.Running) {
    if (session.currentActivity?.id !== item.id) {
      session.currentActivity = currentToolStep(item.id, item.type);
    }
  } else if (method === CodexMethod.ItemCompleted) {
    clearCurrentStep(session, item.id);
  }
}
