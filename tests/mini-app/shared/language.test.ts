import { it, expect } from 'vitest';
import { createLanguageInstance, resolveLanguage, type Translate } from '@/shared/lib/i18n/index.js';

it.each([
  ['en', 'ru', 'ru-RU', 'en'],
  ['ru', 'en', 'en-US', 'ru'],
  ['bad', 'en', 'ru-RU', 'en'],
  [null, 'ru-RU', 'en-US', 'ru'],
  [null, 'fr', 'en-GB', 'en'],
  [null, undefined, 'de-DE', 'ru'],
])(
  'resolves language using saved preference, Telegram and browser priority',
  (saved, telegram, browser, want) => {
    expect(resolveLanguage(saved, telegram, browser)).toBe(want);
  },
);

it('translates dynamic UI text in both languages without altering the supplied value', () => {
  const english = createLanguageInstance('en');
  const russian = createLanguageInstance('ru');

  expect(english.isInitialized).toBe(true);
  expect(english.t('permissionTitle', { tool: 'Bash' })).toBe('Allow Bash?');
  expect(russian.t('permissionTitle', { tool: 'Bash' })).toBe('Разрешить Bash?');
  expect(english.t('updatedAt', { time: '12:30' })).toBe('Updated 12:30');
  expect(english.t('permissionTitle', { tool: '<script>&' })).toBe('Allow <script>&?');
});

it('changes language through i18next without leaking it into another provider instance', async () => {
  const app = createLanguageInstance('ru');
  const story = createLanguageInstance('ru');

  await app.changeLanguage('en');
  expect(app.t('permissionTitle', { tool: 'Bash' })).toBe('Allow Bash?');
  expect(story.t('permissionTitle', { tool: 'Bash' })).toBe('Разрешить Bash?');
});

it('keeps stored status codes translatable after a language switch and handles unknown codes safely', async () => {
  const { feedbackText } = await import('@/shared/lib/i18n/index.js');
  const englishInstance = createLanguageInstance('en');
  const russianInstance = createLanguageInstance('ru');
  const english: Translate = (key, parameters = {}) => englishInstance.t(key, parameters);
  const russian: Translate = (key, parameters = {}) => russianInstance.t(key, parameters);

  expect(feedbackText('dispatched', english)).toBe('Delivered to session');
  expect(feedbackText('dispatched', russian)).toBe('Доставлено в сессию');
  expect(feedbackText('SOME_NEW_CODE', english)).toBe('Something went wrong. Try again.');
  expect(feedbackText('constructor', english)).toBe('Something went wrong. Try again.');
});

it.each([
  [
    'ru',
    'Код подключения истёк, уже введён или не найден. Заново запусти команду подключения на Mac и введи новый код.',
  ],
  [
    'en',
    'The pairing code expired, was already entered or was not found. Run the pairing command on your Mac again and enter the new code.',
  ],
] as const)('explains unavailable pairing codes with a recovery action in %s', async (language, expected) => {
  const { feedbackText } = await import('@/shared/lib/i18n/index.js');
  const instance = createLanguageInstance(language);

  expect(feedbackText('PAIRING_UNAVAILABLE', (key, parameters = {}) => instance.t(key, parameters))).toBe(
    expected,
  );
});
