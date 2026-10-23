import { describe, expect, it } from 'vitest';
import {
  createLanguageInstance,
  feedbackText,
  type Language,
  type Translate,
} from '@/shared/lib/i18n/index.js';
import { isUncertainCommand } from '@/features/send-command/lib/notice.js';

function translator(language: Language): Translate {
  const instance = createLanguageInstance(language);

  return (key, parameters = {}) => instance.t(key, parameters);
}

describe.each(['ru', 'en'] as const)('safe %s feedback', (language) => {
  const t = translator(language);

  it.each(['NO_AUTHENTICATED_CLIENT', 'TELEGRAM_AUTH_FAILED', 'UNAUTHORIZED', 'TOKEN_EXPIRED', 'REVOKED'])(
    'explains authentication failure %s',
    (code) => {
      expect(feedbackText(code, t)).toBe(t('authFailed'));
    },
  );

  it.each(['CLI_WRAPPER_REQUIRED', 'Для отправки промптов запусти remote claude'])(
    'explains the native prompt hint for %s',
    (code) => {
      expect(feedbackText(code, t)).toBe(t('nativePromptHint'));
    },
  );

  it.each([
    'SOME_NEW_CODE',
    'constructor',
    '__proto__',
    'Error: /Users/synthetic/private.log token=synthetic-secret',
    '<script>secret</script>',
  ])('hides untrusted error details %s', (code) => {
    expect(feedbackText(code, t)).toBe(t('requestFailed'));
  });

  it('names a protocol code that has no text of its own', () => {
    expect(feedbackText('REQUEST_FAILED', t)).toBe(t('requestFailedCode', { code: 'REQUEST_FAILED' }));
    expect(feedbackText('REQUEST_FAILED', t)).toContain('REQUEST_FAILED');
  });

  it.each([
    ['NETWORK_UNAVAILABLE', 'networkUnavailable'],
    ['REQUEST_TIMEOUT', 'requestTimedOut'],
    ['DEVICE_QUOTA', 'deviceQuota'],
    ['SESSION_QUOTA', 'sessionQuota'],
    ['STALE_SESSION', 'sessionChanged'],
    ['STALE_EPOCH', 'sessionChanged'],
    ['CAPABILITY_UNAVAILABLE', 'inputUnavailable'],
    ['DESKTOP_CODE_ID_UNVERIFIED', 'setupRequired'],
    ['SESSION_NOT_IDLE', 'sessionBusy'],
    ['QUEUE_FULL', 'serviceBusy'],
    ['PERMISSION_EXPIRED', 'permissionExpired'],
    ['INVALID_REQUEST', 'invalidRequest'],
    ['HISTORY_RELOAD_FAILED', 'historyUnavailable'],
    ['UNKNOWN_AFTER_WRITE', 'commandUncertain'],
    ['COMMAND_DELIVERY_FAILED', 'deliveryFailed'],
    ['REVOKE_FAILED', 'revokeFailed'],
  ] as const)('provides a recovery message for %s', (code, key) => {
    expect(feedbackText(code, t)).toBe(t(key));
  });
});

it('translates existing machine state after language changes without changing retry semantics', async () => {
  const instance = createLanguageInstance('ru');
  const t: Translate = (key, parameters = {}) => instance.t(key, parameters);
  const stored = 'NO_AUTHENTICATED_CLIENT';

  expect(feedbackText(stored, t)).toBe(instance.t('authFailed'));
  await instance.changeLanguage('en');
  expect(feedbackText(stored, t)).toBe('Open the Mini App again from the Telegram bot to sign in.');
  expect(stored).toBe('NO_AUTHENTICATED_CLIENT');
  expect(isUncertainCommand('COMMAND_STATUS_UNKNOWN')).toBe(true);
  expect(isUncertainCommand('COMMAND_PENDING_STATUS')).toBe(true);
  expect(isUncertainCommand('UNKNOWN_AFTER_WRITE')).toBe(false);
  expect(isUncertainCommand(feedbackText('COMMAND_STATUS_UNKNOWN', t))).toBe(false);
});
