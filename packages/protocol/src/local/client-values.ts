export const LocalKind = {
  Hello: 'hello',
  Request: 'request',
  Result: 'result',
  Event: 'event',
  Fragment: 'fragment',
} as const;
export type LocalKind = (typeof LocalKind)[keyof typeof LocalKind];

export const LocalOrigin = { Desktop: 'agent-remote-desktop://local/' } as const;
export type LocalOrigin = (typeof LocalOrigin)[keyof typeof LocalOrigin];

export const LocalFeature = { DesktopGrants: 'desktop-local-grants-v1' } as const;
export type LocalFeature = (typeof LocalFeature)[keyof typeof LocalFeature];

export const LocalOperation = {
  Devices: 'devices',
  Select: 'select',
  History: 'history',
  Send: 'send',
  Receipt: 'receipt',
  PreferencesGet: 'preferences_get',
  PreferencesSave: 'preferences_save',
  Rename: 'rename',
  ReadingGet: 'reading_get',
  ReadingSave: 'reading_save',
  Logout: 'logout',
  MediaBegin: 'media_begin',
  MediaChunk: 'media_chunk',
  MediaFinish: 'media_finish',
  MediaRead: 'media_read',
  MediaReadChunk: 'media_read_chunk',
  MediaAbort: 'media_abort',
  DraftGet: 'draft_get',
  DraftSave: 'draft_save',
  QueueGet: 'queue_get',
  QueueSave: 'queue_save',
  Profiles: 'profiles',
} as const;
export type LocalOperation = (typeof LocalOperation)[keyof typeof LocalOperation];

export const LocalGrantStatus = { Pending: 'pending', Approved: 'approved', Revoked: 'revoked' } as const;
export type LocalGrantStatus = (typeof LocalGrantStatus)[keyof typeof LocalGrantStatus];

export const BrowserKind = {
  Chrome: 'chrome',
  Chromium: 'chromium',
  ChromeForTesting: 'chrome_for_testing',
} as const;
export type BrowserKind = (typeof BrowserKind)[keyof typeof BrowserKind];
