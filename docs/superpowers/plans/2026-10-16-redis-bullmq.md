# Redis and BullMQ Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; run RED/GREEN tests for each task and one final independent review. Never commit.

**Goal:** Add owner-safe Redis history caching and durable BullMQ notification delivery.

**Architecture:** PostgreSQL authorizes reads and versions cached history; its notification outbox survives Redis outages. BullMQ processes outbox IDs through the existing Telegram notification service. Live agent commands retain their current dedup/generation fences.

**Tech Stack:** TypeScript, Redis 7.4, ioredis 6.0.0, BullMQ 6.3.15, PostgreSQL and existing Node/Nest relay.

**Spec:** `docs/superpowers/specs/2026-10-16-redis-bullmq-design.md`

## Global constraints

- No commits, paid services, real-user test notifications or credentials in logs.
- Cache never substitutes for PostgreSQL authentication/ownership checks.
- Queue payload contains only outboxId; provider/user message content stays out of jobs.
- Redis uses persistent AOF and noeviction; producer/cache waits are bounded.
- Production/personal launch enables Redis; legacy focused tests may omit it.

## Review focus

- An event arrives while a history cache fill is in flight: old data must stay under its old revision key.
- A previously authorized device is revoked after warming the cache: reads must fail immediately.
- Redis loses its data after PostgreSQL commit: the outbox must republish unsent work.
- Duplicate jobs or two consumers must not concurrently send the same outbox row.
- Queue or Telegram failure during shutdown must not leave sockets/timers or lose durable intent.

### Task 1: Infrastructure and history cache

**Files:** Add `apps/server/src/infrastructure/redis.ts`, `apps/server/src/history/service.ts`, real Redis/history tests under `tests/`. Modify `relay.ts`, database migration, package manifests and Compose files.

**Interfaces:** `RedisCache.remember<T>(key, validate, load): Promise<T>` uses a 30-second TTL and PostgreSQL fallback. `SessionHistory.page(principal, sessionId, cursor?)` returns `{events, nextCursor}` after current ownership/revision checks. `RelayConfig.redisUrl?: string` enables Redis; `relay.messaging` exposes the queue/cache runtime.

- [x] Write failing real Redis/history tests for read-through, TTL, malformed values, unavailable Redis, owner separation and warm-cache revocation.
- [x] Implement namespaced Redis cache and extract the existing history route into SessionHistory.
- [x] Add history_revision migration and update it transactionally with successful event insertion; test that duplicate events do not change it and new events get fresh cache keys.
- [x] Configure persistent/password-protected local/production Redis and loopback-only test Redis. Pin dependencies and verify tests/typecheck.

### Task 2: BullMQ and outbox consumption

**Files:** Add `apps/server/src/notifications/queue.ts`, `delivery.ts`, queue/delivery integration tests. Modify existing `notifications/worker.ts` and relay notify publishing.

**Interfaces:** `NotificationQueue.enqueue(outboxId)`, `reconcile(db)`, `start(deliver: (id: string) => Promise<number>)`, `stop()`, `close()`. Deliver returns zero when complete/no longer eligible, or retry delay in milliseconds. NotificationWorker retains its existing updates/deliver API and optionally uses the queue.

- [x] Write failing real BullMQ tests for one job per outbox ID, delivery, retry delay and recovery by reconciliation.
- [x] Implement stable job IDs, delayed retries, bounded retention, safe error listeners, producer/worker connection policies and orderly shutdown.
- [x] Move sending into a row-locked delivery service; preserve private-chat registration, per-chat spacing, 403 disabling and retry_after behavior. Test concurrency and recipient isolation with synthetic fetch.
- [x] Publish only after outbox persistence; recover unsent rows after queue loss. Run full unit/integration suite.

### Task 3: Launch, verification and review

**Files:** Modify `main.ts`, personal launcher/runtime, `.env.example`, operations/personal launch docs, README, and integration tests.

- [x] Generate/preserve personal Redis secret, pass Redis config to relay/worker, and await worker shutdown before Redis/database close.
- [x] Verify Compose Redis health and personal settings without printing secrets. Deployed health checks include Redis.
- [x] Run `npm test`, `npm run check:frontend`, production container build/smoke and cache/queue outage scenarios. Review once independently, fix Important/Critical issues with regression tests.
- [x] Restart the personal launcher normally to load backend changes, update the bot menu through its existing flow and verify public health/static assets. Document any tunnel URL change and remaining delivery limits.
