import { ActivityKind } from './activity-kind.js';
import { TOOL_ACTIVITY_KINDS } from './tool-kinds.js';
import { type Session, type SessionActivity } from '@protocol';

export function currentToolStep(id: string, name: string): SessionActivity {
  return { id, kind: TOOL_ACTIVITY_KINDS[name] ?? ActivityKind.Tool, startedAt: Date.now() };
}

export function clearCurrentStep(session: Session, id?: string) {
  if (!id || session.currentActivity?.id === id) {
    delete session.currentActivity;
  }
}
