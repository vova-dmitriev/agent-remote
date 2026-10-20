/** Renames sessions in their agents (Claude Code, Codex); see `SessionNames`. */
export interface SessionNamesPort {
  /** Returns whether the agent itself took the name; the app shows it either way. */
  rename(sessionId: string, title: string): Promise<boolean>;
}

/** The part of the Codex manager that names threads. */
export interface CodexThreadNaming {
  renameThread(threadId: string, name: string): Promise<boolean>;
}
