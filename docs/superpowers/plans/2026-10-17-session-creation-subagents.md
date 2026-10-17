# Session Creation and Subagent Tracking Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Current root executes after structured question delivery. User authorized continuous implementation; never commit.

**Goal:** Start fresh managed Claude Code/Codex sessions from Mini App and observe real child-agent work without mixing it into the parent transcript.

**Architecture:** Keep the existing owner/device/session-generation command fences. A new create_session action uses a verified connected session as the device authorization context; a Mac launcher creates a fresh managed runtime and returns its new session ID. Provider choice is Claude Code or Codex; existing native Desktop threads remain connected separately. Desktop IPC has no create-thread method, so new Codex sessions use the managed app-server rather than pretending to create a Desktop-owned task. Optional native model/cwd/subagents session metadata remains compatible with existing producers.

**Tech Stack:** TypeScript/Zod, existing audited command delivery, managed Codex app-server, Claude wrapper/Terminal on macOS, React/i18next/Storybook/Playwright.

## Constraints

- No automatic prompts, answer choices, permission grants, or real-user test conversations.
- Mac launcher executables/arguments are fixed locally; remote input only chooses provider, existing absolute project cwd and starts without an initial prompt. No shell interpolation.
- Native permission/trust rules remain in force. New Claude Terminal lets the Mac owner handle first-use trust if needed.
- Session creation is idempotent per command ID; uncertain results never spawn another session automatically.
- Child statuses come from native agent states or hooks, never from completion of a spawn/wait tool call. Preserve task/name/model across later sparse events.
- Creation from a Mac with no verified connected source remains an explicitly documented bootstrap boundary.

## Tasks

- [x] Define bounded optional Session.cwd/subagents and createSession capability, create_session action and created session receipt. Write schema/fence regression tests first.
- [x] Implement Codex native child tracker with hydration/live ordering and Claude SubagentStart/Stop hooks. Test queued/running/completed/failed, metadata preservation, stale hydration and source-loss behavior.
- [x] Add compact expandable subagent UI and synthetic stories, RU/EN statuses and offline last-known state; assert actual child updates in browser E2E.
- [x] Implement fixed Mac managed-session launcher, CodexManager.createSession and Claude wrapper correlation. Validate cwd before spawn, reserve source quota, await binding/receipt, preserve unknown-write semantics and return created session ID through audit/recovery.
- [x] Add main-page creation form with provider/project; the first message uses the normal composer, explicit submit, duplicate-submit protection and navigation into the returned session. Test native runtime creation in isolated synthetic CLI/Desktop providers and injectable launcher tests.
- [ ] Run all required checks, review concrete failures, package/deploy without rotating permanent URL, verify public assets and pairing. Document verified support and exact native boundaries.
