import { object } from './events.js';

export function codexTurnError(value: unknown) {
  const error = object(value),
    message = typeof error.message === 'string' ? error.message : '';

  if (/model/i.test(message) && /not supported|not available|not found/i.test(message)) {
    return 'CODEX_MODEL_UNAVAILABLE' as const;
  }

  if (/unauthorized|authentication|access token|sign.in|401|403/i.test(message)) {
    return 'CODEX_AUTH_REQUIRED' as const;
  }

  if (/network|connect|request failed|stream disconnected/i.test(message)) {
    return 'CODEX_NETWORK_ERROR' as const;
  }

  return 'CODEX_TURN_FAILED' as const;
}
