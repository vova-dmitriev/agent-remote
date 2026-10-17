export const SESSIONS_PAGE_IDS = {
  filters: "sessions-provider-filter",
  filterAll: "sessions-provider-all",
  filterClaude: "sessions-provider-claude",
  filterCodex: "sessions-provider-codex",
  root: "sessions-page",
  title: "sessions-page-title",
  list: "sessions-page-list",
  empty: "sessions-page-empty",
  loading: "sessions-page-loading",
} as const

export const SESSION_CREATE_IDS = {
  root: "session-create",
  toggle: "session-create-toggle",
  form: "session-create-form",
  submit: "session-create-submit",
  provider: { root: "create-provider", trigger: "create-provider-trigger", panel: "create-provider-panel" },
  claude: "create-provider-claude",
  codex: "create-provider-codex",
  project: { root: "create-project", trigger: "create-project-trigger", panel: "create-project-panel" },
  projectOption: "create-project-option",
} as const
