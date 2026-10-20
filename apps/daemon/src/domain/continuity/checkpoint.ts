export const CheckpointMessageRole = {
  User: 'user',
  Assistant: 'assistant',
  System: 'system',
  Tool: 'tool',
} as const;
export type CheckpointMessageRole = (typeof CheckpointMessageRole)[keyof typeof CheckpointMessageRole];

export const CheckpointVisibleRole = {
  User: CheckpointMessageRole.User,
  Assistant: CheckpointMessageRole.Assistant,
} as const;
export type CheckpointVisibleRole = (typeof CheckpointVisibleRole)[keyof typeof CheckpointVisibleRole];

export const CheckpointAttachmentStatus = { Available: 'available', Missing: 'missing' } as const;
export type CheckpointAttachmentStatus =
  (typeof CheckpointAttachmentStatus)[keyof typeof CheckpointAttachmentStatus];
