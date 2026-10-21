import type { ModelChoice, SessionRemoval } from '@protocol';

/** Renames sessions in their agents (Claude Code, Codex); see `SessionNames`. */
export interface SessionNamesPort {
  /** Returns whether the agent itself took the name; the app shows it either way. */
  rename(sessionId: string, title: string): Promise<boolean>;
}

/** The part of the Codex manager that names threads. */
export interface CodexThreadNaming {
  renameThread(threadId: string, name: string): Promise<boolean>;
}

/** Removes sessions from the lists and archives or stops them in their agents; see `SessionRemover`. */
export interface SessionRemovalPort {
  remove(sessionId: string, mode: SessionRemoval): Promise<void>;
}

/** The part of the Codex manager that archives threads. */
export interface CodexThreadArchive {
  archiveThread(threadId: string): Promise<void>;
}

/** Switches running sessions to another model; see `SessionModelSwitch`. */
export interface SessionModelPort {
  switch(sessionId: string, choice: ModelChoice): Promise<void>;
}
