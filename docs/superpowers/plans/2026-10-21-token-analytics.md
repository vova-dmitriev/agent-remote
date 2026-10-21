# Token Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Token usage, API-equivalent cost, context fill and Codex rate limits, computed on the Mac from transcripts and shown in the desktop and Telegram apps.

**Architecture:** A daemon collector reads Claude and Codex transcripts incrementally into a per-daemon SQLite file and answers one report query. Per-session usage (tokens, cost, context fill) rides the existing snapshot; the full report travels as a request/response pair (local operation for desktop/extension, relay frames for Telegram), like the changed-file read.

**Tech Stack:** better-sqlite3 (already a daemon dependency), TypeScript, zod, NestJS relay, React Mini App (FSD, Tailwind v4), Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-token-analytics-design.md` (approved: "дальше давай по плану делай все улучшения").

## Global Constraints

- Everything is computed on the Mac; only aggregates leave it. No message text in the store, frames or the relay.
- One store per daemon: `~/.claude-remote/analytics.sqlite` (CLI daemon) and `<desktop-companion>/analytics.sqlite`; file mode 0600 in the 0700 state directory.
- Claude rows are keyed by `(claude, message.id)`; the record with the most output wins (a request's records grow as it streams, and a resume copies it into a second transcript). Codex rows are keyed by `(codex, thread, total_token_usage, last_token_usage)`: Codex repeats a token count when only rate limits change and replays them after a rollback, and the first `session_meta` names the file's thread.
- Cost is labelled "API-equivalent"; a model without a price shows tokens and "—".
- Repo rules: `as const` vocabulary in `packages/protocol/src/analytics/values.ts`, Drizzle-only server data access, `apps/mini-app/AGENTS.md`, ≤200 lines per file, ≤6 files per directory, `npm run check:frontend`, staged validation on commit, synthetic fixtures only.
- Relay protocol bump to 6 (`RelayProtocolFeature.Analytics`); release order relay before daemons.

## Review Focus

1. **First import of 3.3 GB of transcripts** must not block hooks, the relay link or the UI: the import yields between batches; the report shows import progress meanwhile.
2. **A transcript that shrinks or is replaced** (same path, new inode) is re-read from the start without double counting: rows are keyed, not appended.
3. **"Today" uses the Mac's local timezone**, not UTC; a session at 00:30 local belongs to today.
4. **A Claude session whose process moved to another session id** (`/clear`, `/resume`) still maps usage to the app session by the transcript it reads.
5. **Unknown or new model ids** (e.g. a dated suffix) match the price table by prefix and otherwise show tokens without cost, never a wrong price.

---

### Task 1: Storage dependency

Dropped: the store uses better-sqlite3, already a daemon dependency.

### Task 2: Protocol vocabulary, schemas and prices

**Files:** `packages/protocol/src/analytics/{values.ts,schemas.ts,prices.ts}`, `packages/protocol/src/index.ts`, `packages/protocol/src/session/schemas.ts` (session `usage`), frames in `session/schemas.ts`, `connection/values.ts`, `connection/protocol-version.ts`, `local/{client-values,local-client}.ts`.

**Produces:**

- `AnalyticsPeriod = { Today, Week, Month, All }`, `UsageProvider = { Claude, Codex }`.
- `sessionUsageSchema = { tokens: {input, output, cacheRead, cacheWrite}, costUsd: number|null, context: {used, window}|null }` (optional `usage` on `sessionSchema`).
- `analyticsQuerySchema = { period }`; `analyticsReportSchema = { period, importing: {done,total}|null, totals, byModel[], byProject[], bySession[], daily[], rateLimits: {primary, secondary}|null }` with each row `{ key, label, tokens, costUsd }` (sessions add `provider`, `lastAt`; daily rows add `day` and per-model tokens).
- `priceFor(model): ModelPrice | undefined` by longest matching prefix; `costUsd(tokens, price)`.
- `FrameType.AnalyticsRequest/AnalyticsResult`, `LocalOperation.Analytics`, `RelayProtocolFeature.Analytics = 6`.

- [ ] Test `tests/protocol/analytics-prices.test.ts`: prefix match (`claude-opus-5-5-20261001` → Opus 5.5 price), unknown model → undefined, cost arithmetic per million tokens.
- [ ] Prices copied from the official Anthropic and OpenAI pricing pages, with URL and date in the file.
- [ ] Update the public API snapshot; commit.

### Task 3: Collector and store

**Files:** `apps/daemon/src/analytics/{store.ts,claude-usage.ts,codex-usage.ts,collector.ts,report.ts}`; tests `tests/daemon/analytics/*.test.ts`.

**Produces:** `AnalyticsCollector.start()/close()/report(period)/sessionUsage(claudeSessionIdOrThreadId)`; `usageRows(line, context)` parsers.

- [ ] Parser tests: Claude duplicate `message.id` counts once with the last usage; non-assistant and other-session lines ignored; subagent transcript rows carry `parent_session_id`. Codex: sums `last_token_usage`, model from preceding `turn_context`, thread id/cwd from `session_meta`, rate limits from the latest `token_count`.
- [ ] Store tests (temp dir): upsert idempotent; incremental read from stored offset; shrunk/replaced file re-read without double count; schema version mismatch rebuilds.
- [ ] Report tests: totals, by model/project/session, daily buckets in local time (set `TZ` in the test), cost null for unknown models.
- [ ] Import yields between batches (`setImmediate`), exposes progress; commit.

### Task 4: Daemon wiring and transport

**Files:** `apps/daemon/src/main.ts`, `monitor/monitor.ts` (`setSessionUsage`), `runtime/source-poller.ts` or a collector timer, `runtime/relay-frame-router.ts`, `local/controller/documents.ts`, server `apps/server/src/devices/analytics.ts` + controller route `GET /devices/:deviceId/analytics?period=`, realtime wiring like `SessionFiles`.

- [ ] Monitor test: usage set on a session appears in its snapshot.
- [ ] Server test (like `session-files.test.ts`): offline → `DEVICE_OFFLINE`, old protocol → `CAPABILITY_UNAVAILABLE`, other owner → `NOT_FOUND`, device answer returned.
- [ ] Local controller test: owner only; commit.

### Task 5: Mini App

**Files:** `apps/mini-app/src/pages/analytics/**`, settings menu entry, session page usage line, clients (`relay-operations.ts`, desktop `operations.ts`, extension `operations.ts`, `shared/api/application-client.ts`), i18n, stories, e2e `tests/e2e/shell/analytics.spec.ts`, desktop bridge fake answers `LocalOperation.Analytics`.

- [ ] Stories: loaded report, importing, empty, failed, dark.
- [ ] e2e (desktop bridge): settings → Usage shows totals, a model row, a session row; period chips re-query; session page shows the usage line.
- [ ] `npm run check:frontend`; commit.

### Task 6: Deploy and verify on real data

- [ ] Package desktop, build personal, restart both.
- [ ] Compare the report's 30-day Claude output tokens with an independent count over the transcripts (dedup by `message.id`); they must match.
