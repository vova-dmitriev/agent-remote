# Token analytics on the Mac (SQLite)

Date: 2026-10-20. Status: draft for the user's approval.

## Intent

The user runs 20+ Claude Code and Codex sessions at once and cannot see what they cost: which sessions, projects and models burn tokens, how much cache saves, how close a session is to its context window. This is the first of the analytics features discussed in chat (tokens and cost; later: limits, budgets, policies, reports). It lays the storage and collection foundation the later features reuse.

## Decisions the user made

- Everything is computed on the Mac; only aggregates leave it ("да, считай всё на mac").
- Storage is SQLite through the daemon's existing better-sqlite3 ("давай sqlite", replacing the earlier DuckDB choice): about 48k requests a month need no column store, and DuckDB added a ~118 MB native binary. Not the relay's Postgres: per-request rows would leave the Mac, and analytics would not work without a relay.

## Goals

1. **Collector.** The daemon reads token usage from the transcripts already on the Mac and keeps it in a SQLite file:
   - Claude Code: every `type: "assistant"` record with `message.usage` in `~/.claude/projects/*/*.jsonl` and subagent transcripts under `<project>/<session-id>/subagents/`. Fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `message.model`, record `timestamp`, `sessionId`, `cwd`.
   - Codex: `event_msg` records with `payload.type == "token_count"` in `~/.codex/sessions/YYYY/MM/DD/*.jsonl`, using `payload.info.last_token_usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`); model from the latest preceding `turn_context.payload.model`; thread id and cwd from `session_meta`.
2. **Backfill and live updates.** On first start the collector imports all existing transcripts (measured on the user's Mac: 530 Claude files / 1.2 GB, 100 Codex files / 2.1 GB, ~88k usage records). After that it reads only appended bytes, per file, from a stored offset; a file that shrank or changed identity is re-read from the start.
3. **Analytics view** in the app (desktop and Telegram Mini App), one page reachable from the settings menu:
   - totals for a period (today / 7 days / 30 days / all): input, output, cache read, cache write tokens and API-equivalent cost;
   - breakdown tables by model, by project (cwd folder), by session (title, provider, tokens, cost, last activity), sortable;
   - a daily bar chart of tokens or cost for the period, stacked by model;
   - each session page shows that session's totals and its last-turn context fill (`input + cache read + cache write` of the latest turn against the model's context window; Codex reports `model_context_window`, Claude windows come from the price table).
4. **Aggregates only off the Mac.** The relay and the Mini App receive computed rows (numbers, model names, folder names, session ids/titles already shared today), never message text.

## Non-goals (this spec)

- Budgets, limits, policies, alerts, weekly reports, anomaly detection (later specs reuse this collector).
- Claude Desktop Chat and Codex Desktop app internals beyond their transcripts on disk.
- Exact billing: subscription plans do not bill per token; cost is an API-price equivalent and labelled so.
- Server-side storage of analytics.

## Constraints and verified facts

- **One file per daemon.** The CLI daemon and the desktop companion can run together, so each keeps its own file in its own state directory: `~/.claude-remote/analytics.sqlite` and `<desktop-companion>/analytics.sqlite`. Both read the same transcripts, so both show the same numbers.
- **Claude writes usage twice.** In the largest transcript, 10,873 assistant records carry usage for 5,350 distinct `message.id`s (streamed content blocks repeat the usage). Rows are keyed by `(provider, message id)`; the last record per id wins (its usage is final).
- **Codex usage is per event.** `last_token_usage` is the increment for that event; `total_token_usage` is cumulative and is not summed. Key: `(thread id, file offset of the record)`.
- **Privacy.** Transcripts are read locally; the SQLite file stores numbers, model names, cwd, session ids and timestamps only, no message text. The file lives in the 0700 state directory with 0600 permissions. Nothing new goes into version control; tests use synthetic transcripts.
- **Multi-user.** The relay endpoint is scoped to the authenticated owner and the owner's device, like every other device request.
- Repo rules apply: domain vocabulary in `as const` objects, frontend rules in `apps/mini-app/AGENTS.md`, `npm run check:frontend`, staged validation on commit.

## Design

### Storage (`apps/daemon/src/analytics/`)

- `usage` table: `provider`, `record_key` (unique per provider), `session_id` (Claude session id or Codex thread id), `parent_session_id` (for subagents, else null), `model`, `cwd`, `occurred_at` (timestamp), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`. Upsert on `(provider, record_key)`.
- `sources` table: `path`, `device` + `inode`, `size`, `offset`, `updated_at`, for incremental reads.
- `context` table: last turn per session (`session_id`, `model`, `context_tokens`, `context_window`, `occurred_at`).
- The file is a cache: deleting it triggers a full re-import. A schema version in the store's `meta` table; a version mismatch drops and rebuilds.

### Collector

- Runs in the daemon process in the background with low priority. Initial import is batched (e.g. 5,000 rows per transaction) and must not block hooks, the relay link or the UI. Progress is exposed (`importing: files done / total`).
- Live updates: re-scan on a timer (e.g. every 30 s) plus a nudge when a hook names a `transcript_path`. Only grown files are read.
- Malformed or partial lines are skipped. A line still being written (no trailing newline) is left for the next pass.

### Pricing

- `packages/protocol/src/analytics/prices.ts`: per model id prefix, USD per million tokens for input, output, cache read, cache write; context window size; source URL and the date checked. Values are copied from the official Anthropic and OpenAI pricing pages at implementation time. A model without an entry shows tokens and "—" for cost.

### Queries and transport

- Daemon query API: `summary(period)`, `byModel(period)`, `byProject(period)`, `bySession(period, limit)`, `daily(period)`, `session(id)`. All return aggregate rows.
- Desktop and extension: a new `LocalOperation.Analytics` request.
- Telegram Mini App: a relay request/response pair modelled on the existing profiles request (`ProfilesRequest`), carrying the query and its rows, gated by a new `RelayProtocolFeature` (protocol version bump). A device without the feature shows "Update the companion on this Mac".

### UI (`apps/mini-app`)

- New page `analytics` (FSD: `pages/analytics`, `widgets/analytics-*`, `entities/usage`), opened from the settings menu ("Usage").
- Period chips, totals cards, chart, three tables. Loading skeleton during initial import with the progress line. Empty state when there are no records.
- Session page: a compact line under the title, `128k / 200k context · $3.41 · 1.2M tokens`.
- English and Russian copy through the existing i18n.

## Left to the builder

- Chart implementation (plain SVG/CSS bars preferred over a new chart dependency).
- Exact batch sizes and timer intervals.
- Table sorting defaults.

## Calls I made (the user can override)

1. One SQLite file per daemon, not one shared file: each daemon writes only its own.
2. Cost is API-price equivalent, labelled as such; unknown models show tokens only.
3. The price table is checked into the repo and updated by hand.
4. Analytics opens from the settings menu as "Usage", not as a new tab in the sidebar.
5. Subagent usage counts toward its parent session and is also listed separately in the session's breakdown.
