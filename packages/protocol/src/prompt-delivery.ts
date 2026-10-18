import { PromptDelivery } from './values/command.js';
import { SessionStatus } from './values/session.js';

export interface PromptTurnBarrier {
  lastEventAt: number;
  observedBusy: boolean;
}

export function advancePromptBarrier(
  session: { status: SessionStatus; lastEventAt: number },
  barrier: PromptTurnBarrier,
): boolean {
  if (session.status !== SessionStatus.Idle) {
    barrier.observedBusy = true;

    return false;
  }

  return barrier.observedBusy || barrier.lastEventAt !== session.lastEventAt;
}

export function canDeliverPrompt(status: SessionStatus, delivery?: PromptDelivery): boolean {
  return (
    status === SessionStatus.Idle ||
    (delivery === PromptDelivery.Immediate && status === SessionStatus.Running)
  );
}
