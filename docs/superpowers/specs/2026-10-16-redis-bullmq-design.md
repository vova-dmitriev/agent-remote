# Redis cache and BullMQ messaging

Implement Redis and BullMQ in the existing service. Keep the personal deployment local and free, preserve Claude/Codex separation and all owner/generation/dedup checks. This is a server architecture change, implemented inline under the user's standing instruction to continue authorized work. Never commit.

## Decisions

Use BullMQ over the same Redis deployment rather than operating Kafka. BullMQ handles background Telegram notifications with stable outbox IDs, retries, delayed jobs and bounded completed/failed retention. Interactive agent commands stay on the existing authenticated WebSocket path; queue redelivery must never start another model turn.

PostgreSQL remains authoritative. Persist notification intent in its existing outbox before publishing a job containing only `outboxId`. A periodic reconciler republishes unsent, eligible outbox records after enqueue failure or Redis data loss. Consumers re-read recipient/notification eligibility from PostgreSQL and lock the outbox row before sending. Delivery is at least once: Telegram has no transaction shared with PostgreSQL, so a process crash after a successful send can still duplicate a notification.

Cache session event history for 30 seconds. Every request authenticates against PostgreSQL and verifies current ownership/revocation before reading the cache. Add a device history revision, incremented in the same database transaction as every new event insertion. Keys include namespace, owner, device, session, revision and pagination cursor. This prevents cache-fill races and stale pages after newly committed events without relying on asynchronous invalidation. Corrupt cache values and unavailable Redis fall back to PostgreSQL. Never cache bearer tokens, authorization or pairing decisions.

Use separate Redis clients for short-lived producer/cache requests and worker blocking operations. Bound producer waits; worker connections use unlimited per-request retries as BullMQ requires. Retry network/Telegram failures with backoff; respect Telegram retry_after and per-chat spacing. Redis uses AOF, persistent volumes and noeviction because evicting queue keys corrupts BullMQ state. Cache TTL and job retention limit normal growth; PostgreSQL outbox permits recovery if Redis fills or is lost.

## Operations

Production/personal entrypoints configure Redis and start the notification worker. Personal setup generates a private Redis password, launches loopback-only Redis through compose.local.yml and requires no manual secret editing. Production Compose uses a private Redis service; test Compose exposes only loopback. Existing programmatic createRelay callers may omit Redis for focused compatibility tests; deployed entrypoints must supply it.

Close the Telegram poller and queue worker before the relay/Redis clients. Health checks verify configured Redis as well as PostgreSQL; a cache outage does not invalidate authorization or lose outbox intent. Log service/error codes without connection URLs, passwords or job contents. An actual personal-runtime restart is needed to load backend changes; its launcher refreshes the bot menu if the Quick Tunnel URL changes.

## Acceptance

Run real PostgreSQL/Redis tests for cache hits, TTL, owner separation, revocation after a warm cache, a new event revision, malformed cache values and Redis fallback. Run real BullMQ jobs with a synthetic Telegram transport for delivery, duplicate job/outbox IDs, delayed retry, disabled private chats, concurrent workers and recovery after queue loss. Preserve existing tests, source gates and production build. Verify personal Redis health and the restarted service without sending test messages to real people.
