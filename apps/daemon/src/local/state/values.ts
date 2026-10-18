export const LocalDocumentKind = {
  Reading: 'reading',
  Preferences: 'preferences',
  Draft: 'draft',
  Queue: 'queue',
  QueueBarrier: 'queue_barrier',
  Title: 'title',
} as const;
export type LocalDocumentKind = (typeof LocalDocumentKind)[keyof typeof LocalDocumentKind];
