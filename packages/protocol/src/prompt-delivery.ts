import { PromptDelivery } from './values/command.js';
import { SessionStatus } from './values/session.js';

export function canDeliverPrompt(status: SessionStatus, delivery?: PromptDelivery): boolean {
  return (
    status === SessionStatus.Idle ||
    (delivery === PromptDelivery.Immediate && status === SessionStatus.Running)
  );
}
