export const READING_POSITION_STORAGE_KEY = "agent-remote:reading:v1"

export const READING_POSITION_LIMITS = {
  entries: 100,
  scopeLength: 1024,
  messageIdLength: 512,
  cursorLength: 2048,
  offset: 1_000_000,
  saveDelayMs: 600,
} as const
