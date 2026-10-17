# New sessions and subagents

The home page offers **New session** for a verified online Mac with known project folders. Choose Claude or Codex and an existing connected project's folder. Submit once; the Mini App opens the new session only after the Mac returns its identity and an authoritative snapshot includes it. Write the first message in the normal composer.

- **Codex:** creates a fresh managed CLI/app-server thread with `thread/start`. It does not claim to create a Desktop-owned conversation; existing Codex Desktop sessions remain independently connected.
- **Claude:** opens the managed Claude Code wrapper in Terminal on macOS. Existing project trust and native permission rules apply. A private one-use launcher correlates the new wrapper with its verified session.
- The Mac validates the existing absolute directory. Arbitrary commands, executables and CLI flags cannot be supplied by the Mini App.
- Creation uses the existing account/device/target/generation fences and command journal. Repeated command IDs return the stored new session ID. An uncertain launch is never automatically repeated; status recovery uses the original command.
- Creation needs an existing verified session as its authorization context. Bootstrap without any connected source and arbitrary new project folders are outside this flow.

Inside a session, **Subagents** expands a compact list of child tasks and statuses. Codex CLI/Desktop child states come from native `collabAgentToolCall` / `subAgentActivity` events. Spawn and wait tool completion never stand in for a child's completion. Repeated snapshots and delayed hydration cannot replace newer child states. Historical task/model details fill missing metadata. Claude uses `SubagentStart` and `SubagentStop` hooks; a child's stop does not finish the parent turn. Source loss marks unfinished children unknown while preserving completed states.

Synthetic unit, relay, Storybook and mobile E2E coverage exercises creation, ownership, project validation, duplicate submissions, result recovery, child lifecycle and ordering. Real user conversations are not prompted or answered during verification.
