export const SESSION_PAGE_IDS = {
  root: "session-page",
  back: "session-page-back",
  title: "session-page-title",
  status: "session-page-status",
  sourceError: "session-page-source-error",
  questions: "session-questions",
  permissions: "session-page-permissions",
  history: "session-page-history",
  terminal: "session-page-terminal",
} as const

export const PERMISSION_IDS = {
  root: "session-permission",
  title: "session-permission-title",
  remaining: "session-permission-remaining",
  input: "session-permission-input",
  allow: "session-permission-allow",
  deny: "session-permission-deny",
} as const

export const SESSION_FEED_IDS = {
  root: "session-feed",
  frame: "session-feed-frame",
  content: "session-feed-content",
  virtualList: "session-feed-virtual-list",
  virtualRow: "session-feed-virtual-row",
  rail: "session-feed-rail",
  marker: "session-feed-marker",
  preview: "session-feed-preview",
  previewAuthor: "session-feed-preview-author",
  previewText: "session-feed-preview-text",
  previewTime: "session-feed-preview-time",
  bottom: "session-feed-bottom",
  terminal: "session-feed-terminal",
  message: "session-feed-message",
  text: "session-feed-message-text",
  empty: "session-feed-empty",
  loading: "session-feed-loading",
  skeletonMessage: "session-feed-skeleton-message",
} as const

export const USER_INPUT_IDS = {
  root: "answer-question",
  body: "answer-question-body",
  title: "answer-question-title",
  question: "answer-question-field",
  option: "answer-question-option",
  other: "answer-question-other",
  custom: "answer-question-custom",
  submit: "answer-question-submit",
  skip: "answer-question-skip",
  remaining: "answer-question-remaining",
} as const

export const SUBAGENT_IDS = {
  root: "subagents",
  toggle: "subagents-toggle",
  list: "subagents-list",
  row: "subagent-row",
  open: "subagent-open",
  status: "subagent-status",
  task: "subagent-task",
  offline: "subagents-offline",
} as const

export const ACTIVITY_IDS = {
  root: "session-activity",
  spinner: "session-activity-spinner",
  label: "session-activity-label",
} as const

export const SUBAGENT_VIEW_IDS = {
  root: "subagent-view",
  back: "subagent-view-back",
  title: "subagent-view-title",
  status: "subagent-view-status",
  sessionStatus: "subagent-view-session-status",
  unavailable: "subagent-view-unavailable",
  error: "subagent-view-error",
} as const

export const TOOL_ACTIVITY_IDS = {
  root: "tool-activity",
  name: "tool-activity-name",
  detail: "tool-activity-detail",
  phase: "tool-activity-phase",
} as const
