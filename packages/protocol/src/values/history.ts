export const HistoryDirection = {
  Latest: 'latest',
  Around: 'around',
  Before: 'before',
  After: 'after',
  Message: 'message',
} as const;

export type HistoryDirection = (typeof HistoryDirection)[keyof typeof HistoryDirection];

export const HistoryStatus = {
  Loading: 'loading',
  Ready: 'ready',
  Error: 'error',
} as const;

export type HistoryStatus = (typeof HistoryStatus)[keyof typeof HistoryStatus];

export const AttachmentKind = {
  Image: 'image',
  File: 'file',
} as const;

export type AttachmentKind = (typeof AttachmentKind)[keyof typeof AttachmentKind];

export const AttachmentMode = {
  Native: 'native',
  Reference: 'reference',
} as const;

export type AttachmentMode = (typeof AttachmentMode)[keyof typeof AttachmentMode];

export const FileChangeKind = {
  Add: 'add',
  Delete: 'delete',
  Update: 'update',
} as const;

export type FileChangeKind = (typeof FileChangeKind)[keyof typeof FileChangeKind];

export const HistoryPageDirection = {
  Before: HistoryDirection.Before,
  After: HistoryDirection.After,
} as const;
export type HistoryPageDirection = (typeof HistoryPageDirection)[keyof typeof HistoryPageDirection];
export const HistoryNavigationDirection = {
  ...HistoryPageDirection,
  Latest: HistoryDirection.Latest,
} as const;
export type HistoryNavigationDirection =
  (typeof HistoryNavigationDirection)[keyof typeof HistoryNavigationDirection];

export const HistoryCursorPrefix = {
  Cache: 'cache:',
  Source: 'source:',
  Position: 'position:',
} as const;

export type HistoryCursorPrefix = (typeof HistoryCursorPrefix)[keyof typeof HistoryCursorPrefix];
