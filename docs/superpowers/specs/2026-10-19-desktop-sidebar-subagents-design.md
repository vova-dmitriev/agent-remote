# Desktop session sidebar, settings menu and subagent view

Date: 2026-10-19. Status: approved by the user in chat ("норм") after reviewing the Storybook mockup (branch `spike/desktop-sidebar`, worktree `agents-remote-lanes/sidebar`, uncommitted spike).

## Intent

The user drives many agent sessions at once from the desktop app and the Telegram Mini App. Today the desktop app shows one session list page and one session page; switching means going back and forth, there is no search, "Accounts & keys" sits as a button under the list, and subagents are a non-interactive list. The user wants the Codex-desktop way of working: a persistent left sidebar to switch and search sessions, settings out of the way, and the ability to open any subagent and watch what it is doing.

## Goals

1. **Desktop sidebar** (desktop host, viewport ≥ 960 px): persistent left column with the session list; the right pane shows the selected session (existing session page). As built in the mockup:
   - top: device line (`<device> • Online`), "New session" button, search field with ⌘K hint, provider chips All / Claude / Codex;
   - list grouped by recency (Today / Yesterday / Earlier), newest first; row = provider icon with a status badge, one-line title, secondary line `project · model`, relative time;
   - status colors (single source, also applied to the existing session card): running = blue, pulsing; waiting for input/permission = amber; idle = solid grey; unavailable = hollow grey ring; too large to mirror / observe-only keep their own labels;
   - search matches title, project, model and provider name, highlights matches, "No sessions match" empty state, Esc clears;
   - keyboard: ⌘K focuses search (expands the rail if collapsed), ↑/↓ moves, Enter opens;
   - collapsible to an icon rail; collapse state remembered per viewer (local storage, try/catch).
   - nothing selected: the placeholder pane from the mockup.
   - below 960 px and in the Telegram Mini App the current single-column list/page navigation stays.
2. **Settings menu** (all hosts): a Lucide `Settings` icon button at the top right of the header opens the shared dropdown with "Accounts & keys" (existing `accountsTitle` copy). Remove the "Accounts & keys" button under the session list. Language, theme, Online and Sign out stay in the header.
3. **Subagent view** (desktop and Telegram Mini App): clicking a subagent in the session's subagent list opens a read-only view of that subagent's work in the existing message feed renderer, including its tool calls (rendered the same way the parent feed renders tool activity), live-updating while the subagent runs, with a back control to the parent session.
4. **Backfill**: when the daemon first observes a Claude session (or restores it), it lists that session's existing subagents from `<session transcript dir>/<session-id>/subagents/agent-<id>.jsonl` + `agent-<id>.meta.json` (type, model, description, finished flag), so subagents started before the companion are visible. Internal untyped side agents without a transcript file are not listed.

## Non-goals

- Grouping by project (recency only for now).
- Moving language/theme/sign-out into settings.
- Editing, steering or stopping a subagent from the view (read-only).
- Codex subagents (Codex has its own subagent model; out of scope unless trivially shared).
- Wiring the sidebar into the Telegram Mini App.

## Anti-goals (would make it a failure even if it works)

- Reading any file outside the owning session's own `subagents/` directory, or for an agent id the daemon has not listed for that session (path traversal / cross-session leakage).
- Subagent content reaching the relay or another owner/device without the same ownership checks as session history.
- A second, divergent message renderer for subagents.
- New global CSS files (Tailwind utilities + tokens only, allowlist enforced).

## Constraints

- Follow AGENTS.md and apps/mini-app/AGENTS.md: FSD layers (sidebar = widget, header = widget), Tailwind tokens, shadcn primitives, Lucide, RU + EN copy, static test IDs, no assertions in stories, ≤6 files per directory, named `as const` vocabulary, ownership checks on every data path.
- Protocol: subagent history is requested through the existing history window API with an optional `agentId` (or a sibling request kind); new wire fields must be tolerant on read (unknown values do not fail whole frames) and documented in the release-order note.
- Desktop history cursors semantics (Task 31) apply to subagent history as well.
- Synthetic fixtures only in tests and stories.

## Decided by the user

Recency grouping; placeholder when nothing selected; header keeps language/theme/sign-out; settings gear with Accounts & keys; subagent view shows tool calls; available in desktop and Telegram Mini App; backfill older subagents.

## Controller calls after the builder check (2026-10-19)

1. **Identity:** the subagent key is the Claude hook `agent_id`; the transcript is `<session transcript dir>/<session-id>/subagents/agent-<agent_id>.jsonl` (the diagnosis matched hook ids to these files; `SubagentStop` also carries `agent_transcript_path`). Backfilled entries use the same key, so hooks and backfill merge into one entry. The per-session allowlist for reads IS the session's subagent list. New subagent fields (`type`, `description`, `transcriptAvailable`) are optional, and `subagentSchema` must parse tolerantly on read (unknown/extra fields stripped, not rejected) — old relays/clients keep working; release-order note updated.
2. **Transport:** subagent history uses the same history request with an optional `agentId`, on both transports. In the Telegram Mini App it flows through the relay exactly like session history, with the same owner + device + session checks on the relay and in the daemon (the daemon additionally checks `agentId` is in that session's list). No new relay storage.
3. **Reader:** reuse the existing transcript page reader/parser parameterized by file path; extend it once (for both parent and subagent) to surface tool-use/tool-result entries as the feed's existing tool activity items, behind a flag the subagent view enables (the parent feed keeps its current behavior). Cursors are per file: each subagent view has its own window state keyed by session + agentId + generation. Tool calls carry a bounded input summary (command, file path, URL, query or prompt, ≤ 512 B); tool results carry only their id and outcome (completed or failed) and never their output (controller ruling, Task 34 review).
4. **Navigation:** a route `…/sessions/:sessionId/agents/:agentId` (deep-linkable, refresh restores it); back returns to the parent session; in Telegram the native BackButton is wired like the session page. The sidebar keeps the parent session row selected while a subagent is open.
5. **Backfill timing:** list `subagents/*.meta.json` when the daemon first observes/restores a Claude session and again whenever a subagent view or the subagent list is opened (cheap directory scan, cap 50 newest by mtime — existing cap and snapshot budget unchanged). Meta `finished: true` sets Completed and overrides a restored Unknown.
6. **Live updates:** reuse the session-history live mechanism (poll/stream as the parent uses) only while the subagent view is open; stop on close. Empty/error states: "Transcript unavailable" (missing file), and the existing offline/observe-only banners.
7. **Desktop shell:** the sidebar layout applies only in the desktop host at ≥ 960 px (existing host detection in app/host); `/` in the desktop shell shows the placeholder pane; the Mini App keeps its routes.

## Left to the builder (controller calls)

- Exact component split inside widgets/session-sidebar and widgets/desktop-header (start from the spike code).
- How the session list data source is shared between the existing sessions page and the sidebar (selectors in entities/session).
- Live update mechanism for the subagent view (reuse the transcript reader/source poller used for session history).
- Whether `agentId` rides on the existing history request schema or a new request kind — whichever keeps old clients tolerant.
