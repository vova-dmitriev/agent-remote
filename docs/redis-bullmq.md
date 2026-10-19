# Redis and BullMQ

Redis 7.4 stores short-lived history pages and BullMQ notification state. PostgreSQL remains authoritative for ownership, sessions, command dedup and notification intent. Claude and Codex use the same infrastructure; their source capability rules remain unchanged.

## Personal launch

`npm run personal` generates/preserves `PERSONAL_REDIS_PASSWORD` in the private `.env`, starts authenticated Redis through `compose.local.yml`, and passes its URL to the relay. Redis listens only on `127.0.0.1:56379`; PostgreSQL stays on 55433. The `personal_redis` volume preserves Redis AOF data. No paid Redis account or external hosting is needed.

Stopping the launcher drains notification delivery before closing relay/database/Redis clients. A restart may replace the Quick Tunnel URL; the launcher updates the bot menu automatically. Device configuration uses loopback, so a hostname change alone does not require re-pairing.

## Production configuration

The entrypoint requires `REDIS_URL` with `DATABASE_URL`, `BOT_TOKEN` and `PUBLIC_ORIGIN`. For `compose.yml`, set `REDIS_PASSWORD` to a random hexadecimal value; Compose builds the internal authenticated URL without publishing Redis ports. Personal mode still uses the free HTTPS tunnel.

Redis uses AOF (`appendfsync everysec`), a 256 MB memory limit and `maxmemory-policy noeviction`. Never enable arbitrary key eviction for BullMQ. Completed/failed jobs have age/count retention. Cache values expire after 30 seconds and entries above 256 KiB are skipped. If memory fills, cache writes fall back to PostgreSQL and the outbox retains notification intent. Monitor memory and queue failures.

Health checks cover PostgreSQL and configured Redis. Cache reads tolerate Redis failure while health reports the unavailable dependency. Producer/cache commands use bounded retries and a 1.5-second timeout. Worker connections use unlimited per-request retries for BullMQ blocking operations.

## History cache

Every history request authenticates and checks current ownership/revocation in PostgreSQL before accessing Redis. Keys include database namespace, owner, device, session, history revision and pagination cursor. Event insertion, revision increment and eligible notification intent commit together. An old in-flight cache fill can write only its captured revision key. Duplicate events do not change the revision or create another outbox row.

Malformed cache values are ignored. Bearer tokens and pairing approvals are never cached. Redis does contain cached session messages and has the same operator-access boundary as PostgreSQL; this is not end-to-end encryption.

## Notification queue

A job contains only `{outboxId}` and uses that ID for deduplication. The worker re-reads the current recipient and eligibility from PostgreSQL. A row lock prevents concurrent delivery of the same outbox record. Sent records are skipped. The delivery service enforces per-chat spacing, Telegram retry_after, retry backoff and disabling notifications after HTTP 403.

Every second the reconciler scans eligible unsent outbox rows and restores missing, failed or completed-but-unsent jobs. This recovers from publication failure and lost Redis queue data. PostgreSQL intent takes precedence over completed Redis metadata. Only one Telegram updates poller should run per bot.

Delivery is at least once: a crash after Telegram accepts a send but before the PostgreSQL commit may duplicate a notification. Interactive prompt/permission commands keep their authenticated WebSocket path, command IDs, expiry and generation fences; BullMQ does not retry model turns.

## Retention scheduler

Every relay upserts the same BullMQ job scheduler (`retention`, every 60 seconds) and runs a worker, so each interval produces one job and one relay runs it. The job marks commands unacknowledged after 15 seconds as unknown, prunes expired attachments, drops events older than 24 hours or beyond each device's newest 10 000, and drops command audit older than 24 hours. Deletes run in batches of 5 000 rows until a batch removes nothing. Without Redis the relay runs the same pass in-process every 60 seconds.

## Verification

`docker compose -f compose.test.yml up -d --wait` starts PostgreSQL 55432 and Redis 56380. Tests use isolated namespaces and synthetic Telegram transports; no test messages go to real users. Run `npm test` and `npm run check:frontend`. Tests cover cache hit/TTL/corruption/fallback, ownership/revocation, in-flight revision races, concurrent delivery, delayed retry, network loss through a Redis proxy, queue reconstruction and startup/shutdown failures.

Build `docker build -t claude-remote:local-test .`, then run `npm run smoke:image` for real container HTTP/WebSocket/database/Redis/static checks. See the [design](superpowers/specs/2026-10-16-redis-bullmq-design.md) and [implementation plan](superpowers/plans/2026-10-16-redis-bullmq.md).
