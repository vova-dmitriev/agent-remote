# 01 — Users and Devices Implementation Plan

> **Справочная версия.** Исполнять [основной план имплементации](2026-10-16-claude-remote-implementation.md). Чеклисты этого файла не выполняются дополнительно: задачи перенесены и согласованы там.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Для зависимых задач рекомендуется executing-plans.

**Goal:** Многопользовательская identity/ownership и самостоятельная привязка Mac.

**Architecture:** Общий NestJS relay разделяет данные по ownerId; daemon каждого Mac подключается исходящим WSS. React Mini App использует Telegram auth. Устройства, события, replay и commands всегда проходят ownership checks.

**Tech Stack:** Node.js 22+, TypeScript, pnpm, React/Vite, NestJS/ws, Zod, PostgreSQL/pg, SQLite/better-sqlite3, Vitest, Playwright.

**Spec:** [Общая спецификация](../specs/2026-10-16-telegram-cmux-design.md). Статус: проект для проверки; подтверждён многопользовательский масштаб, остальные границы — явные допущения.

**Prerequisites:** Репозиторий выбран: `/absolute/path/claude-remote`. Перед реализацией пользователь проверяет spec; создание репозитория само по себе не означает утверждение дизайна. Реализация пока не начата.

**База оценки:** один разработчик с AI, адаптация проверенных upstream-модулей, включая целевые тесты. Часы активной работы; общий резерв и внешние ожидания учитываются отдельно в [бюджете](../../delivery-estimate.md).

## Global Constraints

- Сервис для нескольких пользователей; личный аккаунт на Telegram ID. Квота пилота: 1 active Mac/user, 10 sessions/device, нагрузочная цель 20 simultaneous users. Общего доступа, организаций и биллинга нет.
- Репозиторий: `/absolute/path/claude-remote`. Все пути реализации относительны его корню. Коммиты не выполнять.
- Node.js 22+, TypeScript strict; PostgreSQL на relay, SQLite на daemon. Один relay instance в пилоте. Никакого Agent SDK для подмены существующих сессий, shell endpoint, автоматического allow и постоянных permission rules. PTY-wrapper владеет только явно запущенным пользователем дочерним Claude.
- Все HTTP/WS/history/replay/notifications/commands проверяют ownerId, выведенный из валидной auth session либо device token. Запрещено доверять ownerId от клиента. Чужой resource и отсутствующий resource дают NOT_FOUND.
- Target: discriminated kind + deviceId + connectorId + source-specific ID + generation. window/workspace/surface UUID обязательны только для cmux. Проверять capabilities на relay и companion. Companion не требует cmux; cmux-only bridge запускается внутри cmux без allowAll.
- Лимиты из spec: snapshot 200 строк/64 KiB/1 секунда; discovery 5 секунд; JSONL line 1 MiB; prompt 16 KiB; command TTL 15 секунд/dedup 24 часа; events 24 часа/10 000 на device; heartbeat 10 секунд/offline 30 секунд; initData 300 секунд/future skew 30 секунд; bearer 15 минут; WS auth 5 секунд; pairing 128 бит/5 минут; permission 45 секунд/hook timeout 60 секунд.
- Socket frame максимум 128 KiB, queue максимум 256 frames/1 MiB. Квоты: 30 commands/min/user, 10 auth/min/IP, 5 pairing attempts/min/IP и user. Backup retention максимум 7 дней. В логах нет токенов, initData и содержимого терминалов/команд.

## Review Focus

1. Чужой authenticated Telegram user читает resource по UUID — NOT_FOUND.
2. Одновременные claims/code reuse не создают два ownership bindings.
3. Отозванный device token и старый socket epoch теряют доступ сразу.
4. Поддельные/просроченные initData и смешение app/device tokens отклоняются.
5. Desktop Chat AX, Desktop Code hooks и CLI/PTY проверены раздельно; cmux optional, недоказанные input capabilities выключены.

## Общие контракты

| Путь                                         | Ответственность                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/protocol/src/{schemas,types}.ts`   | Zod wire schemas и типы из spec, без логики cmux/Telegram                         |
| `apps/daemon/src/`                           | Companion, source adapters, hooks/JSONL, registry, журнал, WSS client, dispatcher |
| `apps/server/src/`                           | Telegram auth, ownership, pairing, relay gateways, PostgreSQL, notifications      |
| `apps/mini-app/src/`                         | Список, session detail, event reducer, transport, controls                        |
| `tests/{fixtures,integration,e2e}/`, `docs/` | Обезличенные fixtures, проверки, совместимость и runbook                          |

Сквозные типы `Target`, `Session`, `Status`, `EventEnvelope`, `Command`, `Action`, `CommandResult`, `PendingPermission` определены в spec и спецификации интеграций; экспортировать из `@remote/protocol`. Все даты — epoch milliseconds, кроме Telegram `auth_date` в seconds. Номер протокола — 1.

`AppSnapshot = { sessions: Session[]; deviceStatus: 'online' | 'offline'; cursor: { streamId: string; seq: number }; permissions: PendingPermission[]; terminal: TerminalSnapshot | null }`.

`TerminalSnapshot = {sessionId: string; generation: string; text: string; capturedAt: number}`.

`SessionAdapter` и CapabilitySet определены в [спецификации интеграций](../specs/2026-10-16-claude-connectors-design.md). `CmuxAdapter` — реализация только для `Extract<Target, {kind: 'cmux'}>`; cmux-методы не принимают CLI/Desktop target. Все адаптеры используют общий owner-scoped dispatcher.

`SessionRegistry` предоставляет `ingestHook(input: HookEnvelope): EventEnvelope[]`, `list(): Session[]`, `get(id: string): Session | undefined`, `invalidate(target: Target): void`. `HookEnvelope = { target: Target; invocationId: string; receivedAt: number; input: Record<string, unknown> }`.

`EventStore` предоставляет `append(event: EventEnvelope): void`, `replay(cursor: {streamId: string; seq: number}): EventEnvelope[] | 'resync_required'`, `prune(now: number): void`. Уникальность события — `(deviceId, streamId, seq)`.

`dispatch(command: Command): Promise<CommandResult>` проверяет локальные preconditions. `PermissionBroker.open(request: PendingPermission): Promise<'allow' | 'deny' | 'local'>`, `resolve(requestId: string, generation: string, decision: 'allow' | 'deny'): boolean`. Broker open связан с конкретным локальным hook connection; `local` не выдаёт allow.

## Task 1: Доказать совместимость и зафиксировать протокол

Оценка: 2–3 часа. Результат: воспроизводимая матрица возможностей и типизированные контракты. Дальнейшее управление зависит от результата.

**Files — Create:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `packages/protocol/package.json`, `packages/protocol/src/{types,schemas,index}.ts`, `packages/protocol/test/schemas.test.ts`, `scripts/probe-cmux.ts`, `scripts/probe-sources.ts`, `docs/compatibility.md`, `tests/fixtures/{cmux,claude}/`.

**Interfaces:** consumes spec; produces `@remote/protocol` с перечисленными выше типами, `commandSchema`, `eventSchema`, `sessionSchema` и `scripts/probe-cmux.ts --read-only`. Root scripts: `test` → vitest run, `typecheck` → проверка TS всех workspaces, `build` → сборка packages/apps, `test:e2e` → playwright test; команды запускать из корня нового проекта.

- [ ] **Step 1 — Создать минимальную workspace/test-конфигурацию и failing contract tests.** В `schemas.test.ts` зафиксировать следующий минимум, а также лимит prompt в байтах и запрет control characters; Target строго discriminated, CLI/Desktop не требуют cmux UUID:

```ts
expect(commandSchema.safeParse({ ...validCommand, version: 2 }).success).toBe(false);
expect(
  commandSchema.safeParse({ ...validCommand, target: { kind: 'cmux', surfaceId: 'focused' } }).success,
).toBe(false);
expect(commandSchema.safeParse({ ...validCommand, action: { type: 'shell', text: 'pwd' } }).success).toBe(
  false,
);
expect(eventSchema.safeParse(validEvent).success).toBe(true);
```

`validCommand`/`validEvent` — полные fixtures по spec с UUID, version 1 и фиксированным временем; хранить рядом с тестом. `expiresAt` проверяется dispatcher по часам, а не статической схемой.

- [ ] **Step 2 — Запустить `pnpm exec vitest run packages/protocol/test/schemas.test.ts`.** Ожидается FAIL на отсутствующих exports; устранить ошибки runner, чтобы причина была в отсутствующем контракте.

- [ ] **Step 3 — Реализовать schemas и выполнить изолированный probe всех источников.** Desktop Chat/Code AX feasibility выполняется до основной реализации backend; если невозможно verified read/send выбранного Chat, пересмотреть эту интеграцию до следующих крупных задач. Сначала `--read-only`: version/help, socket access, capabilities, discovery нескольких окон, UUID targeting, bounded read-screen. Дополнительно probe обычного CLI, Desktop Code hooks и Desktop Chat Accessibility; см. спецификацию интеграций. Снять матрицу available/unsupported/needs_setup на каждой версии, не включать управление по одному факту обнаружения приложения. Затем на специально созданной локальной тестовой Claude session проверить multiline paste/submit, Escape, hook fields/env, момент загрузки hooks, PermissionRequest allow/deny/timeout и закрытие Claude обратно в shell. Не использовать рабочие сессии для ввода. Сохранить только обезличенные результаты.

- [ ] **Step 4 — Запустить contract tests и typecheck; оформить capability matrix.** Для каждой операции записать фактическую команду/RPC, формат ответа, версии cmux/Claude и результат. Подтвердить, что ввод не зависит от focus. Отдельно установить, как теряется binding при выходе Claude; если надёжного условия нет, отметить prompt capability disabled и пересмотреть этот кусок до плана 03. Неподдерживаемый remote permission также выключить с локальным fallback. До положительного probe не считать интерфейс cmux доказанным.

- [ ] **Step 5 — Проверить checkpoint.** В `docs/compatibility.md` есть результаты всех проб, ограничения и дальнейшее решение. `pnpm test` и `pnpm typecheck` проходят. Изменения оставить незакоммиченными.

## Task 2: Пользователи, авторизация и модель ownership

Оценка: 2–4 часа. Результат: два Telegram аккаунта независимо входят в сервис, а SQL-модель и API не смешивают их данные.

**Files — Create:** `apps/server/package.json`, `apps/server/src/{main,config,telegram-auth,auth-session,ownership,db}.ts`, `apps/server/migrations/001_identity.sql`, `apps/server/test/{telegram-auth,ownership,auth-session}.test.ts`, `tests/integration/ownership.test.ts`, `tests/fixtures/telegram.ts`, `compose.test.yml`, `docs/ownership.md`.

**Interfaces:** consumes protocol; produces `Principal = { userId: string; telegramId: string }`, `validateTelegramInitData(raw: string, now: number): {telegramId: string}`, `login(initData: string, now: number): Promise<{token: string; expiresAt: number}>`, `authenticate(token: string, now: number): Promise<Principal>`, `requireOwnedDevice(principal: Principal, deviceId: string): Promise<DeviceRecord>`, `logout(token: string): Promise<void>`. `DeviceRecord = {id: string; ownerId: string; tokenHash: string; revokedAt: number | null; generation: string}`. HTTP: `POST /auth/telegram`, `POST /auth/logout`; userId никогда не принимается как identity из body/query.

- [ ] **Step 1 — Написать failing auth/ownership tests.** Генерировать подписи Telegram в fixture с тестовым bot token; clock фиксированный. Запустить интеграционные тесты на настоящем временном PostgreSQL из compose, не SQLite mock. Assertions:

```ts
expect(() => validateTelegramInitData(tampered, now)).toThrow('UNAUTHORIZED');
expect(() => validateTelegramInitData(expiredBy301Seconds, now)).toThrow('UNAUTHORIZED');
expect(() => validateTelegramInitData(futureBy31Seconds, now)).toThrow('UNAUTHORIZED');
await expect(requireOwnedDevice(userB, deviceA.id)).rejects.toThrow('NOT_FOUND');
expect((await login(validInitDataA, now)).expiresAt).toBe(now + 900_000);
```

Cases: missing user, malformed hash, user ID больше 32 бит, смена username, повторный login не дублирует User, один token не аутентифицирует другого, expiry и logout. SQL composite FK не разрешает чужой ownerId/deviceId. В SQL logs нет secrets. Fixtures userA/userB — два разных authenticated principals, не изменения userId в body.

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/server/test/telegram-auth.test.ts apps/server/test/auth-session.test.ts apps/server/test/ownership.test.ts tests/integration/ownership.test.ts`.** Ожидается FAIL на отсутствующей реализации; перед тестом PostgreSQL стартует через `docker compose -f compose.test.yml up -d --wait`.

- [ ] **Step 3 — Реализовать migrations, auth и ownership.** PostgreSQL tables users, auth_sessions, devices, pairings, sessions, events, command_audit, notification_destinations/outbox. Уникальный telegram_id, token hashes, owner-scoped indexes и composite foreign keys. Подписанные initData → upsert user → случайный token 15 минут. Все репозитории принимают Principal/ownerId от доверенного middleware; scoped SQL predicate обязателен. Signature comparison timing-safe. Username не ключ. Не добавлять глобальный OWNER_TELEGRAM_ID.

- [ ] **Step 4 — Прогнать те же tests и `pnpm typecheck`.** PASS. Проверить повторный запуск migrations на пустой и уже созданной test DB, параллельные logins одного пользователя, отклонение cross-owner insert. Успешный login B сам по себе не даёт B доступ к A.

- [ ] **Step 5 — Проверить checkpoint.** Документировать таблицы и все owner-scoped query paths в `docs/ownership.md`; доказательства двух независимых logins и отрицательных access tests сохранены. Коммит не создавать.

## Task 3: Привязка Mac и аутентифицированные соединения

Оценка: 2–3 часа. Результат: каждый пользователь самостоятельно подключает свой daemon; отзыв прекращает доступ немедленно.

**Files — Create:** `apps/server/src/{pairing,app-gateway,device-gateway,device-service}.ts`, `apps/server/test/{pairing,gateways}.test.ts`, `apps/daemon/package.json`, `apps/daemon/src/{pair-device,relay-client,config}.ts`, `apps/daemon/test/{pair-device,relay-client}.test.ts`, `tests/integration/pairing.test.ts`, `docs/deploy-relay.md`.
**Modify:** protocol schemas для auth/pairing/connection frames; серверная bootstrap/config.

**Interfaces:** consumes Principal/DeviceRecord и db; produces `claimPairing(principal: Principal, code: string): Promise<{claimId: string}>`, `confirmPairing(proofSecret: string, claimId: string, approved: boolean): Promise<{deviceId: string; token: string} | null>`, `revokeDevice(principal: Principal, deviceId: string): Promise<void>`, `connectRelay(): Promise<{close(): Promise<void>}>`. `POST /device/pair/start` регистрирует codeHash/proofHash без device privileges; `POST /pair/claim` принимает code с browser bearer; `POST /device/pair/status` с proof secret в body возвращает локальному daemon pending claim; `POST /device/pair/confirm` с proof secret и claimId подтверждает/отклоняет claim. Передача secrets только в TLS body, не URL. `GET /devices` и `DELETE /devices/:id` owner-scoped. WS `/ws/app` и `/ws/device` имеют разные token audiences. Серверный connection context хранит ownerId/deviceId/epoch.

- [ ] **Step 1 — Написать failing tests на pairing races и channel isolation.** Fake clock и два authenticated users, PostgreSQL transactions. Assertions:

```ts
expect(await claimSameCodeConcurrently(userA, userB)).toHaveLength(1); // один победивший claim
expect(await confirmPairing(wrongProof, claimId, true)).toBeNull();
await expect(revokeDevice(userB, deviceA.id)).rejects.toThrow('NOT_FOUND');
expect(await authenticateRevokedDevice(oldDeviceToken)).toBe(false);
expect(await authenticateAppSocket(deviceToken)).toBe(false);
```

Cases: 5-minute expiry, повтор code, отказ локального пользователя, quota 1 device, два параллельных claims одной квоты, proof poll не отдаёт token постороннему, до local confirm устройство не активно. WS auth deadline 5 секунд, bearer expiry, Origin allowlist, двойное подключение одного device с epoch fencing, revocation закрывает device socket, сообщает app socket и отменяет pending commands. Пользователь A не видит device B в списке.

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/server/test/pairing.test.ts apps/server/test/gateways.test.ts apps/daemon/test/pair-device.test.ts apps/daemon/test/relay-client.test.ts tests/integration/pairing.test.ts`.** Ожидается FAIL на отсутствующих функциях/поведении.

- [ ] **Step 3 — Реализовать pairing, token storage и WS auth.** 128-bit code, отдельный proof secret, TTL 5 минут, одноразовая транзакционная выдача с quota lock. Daemon показывает Telegram ID и ждёт локальное подтверждение. Токен только локально mode 0600; hash на server. Browser auth первым frame за 5 секунд, до auth никаких подписок. Device owner выводится из token, присланный ownerId запрещён. Heartbeats 10 секунд, offline 30 секунд, reconnect jitter 1–30 секунд. Пока control protocol отвечает CAPABILITY_DISABLED.

- [ ] **Step 4 — Прогнать tests и `pnpm typecheck`.** PASS. Два fake daemon подключаются к двум пользователям; подмена deviceId/epoch/token отклоняется. После revoke старое соединение и token не работают. Не писать реальные pairing secrets в acceptance report.

- [ ] **Step 5 — Проверить checkpoint и deployment recipe.** `docs/deploy-relay.md`: env `BOT_TOKEN`, `DATABASE_URL`, `PUBLIC_ORIGIN`; один relay instance, TLS/WSS proxy, migrations, health без пользовательских данных. Docker/image/package versions закрепить при реализации. Деплой с реальными credentials выполняется только при исполнении плана на выбранной пользователем инфраструктуре; этот этап плана допускает локальный test stack. Коммит не создавать.

## Handoff

После task 3 запускать [план integrations](2026-10-16-claude-integrations.md), затем план 02. Не включать дистанционный ввод. Этот подпроект должен самостоятельно проходить auth/ownership/pairing tests и запускать два изолированных fake devices.
