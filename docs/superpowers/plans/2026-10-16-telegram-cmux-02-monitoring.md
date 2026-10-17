# 02 — Monitoring Implementation Plan

> **Справочная версия.** Исполнять [основной план имплементации](2026-10-16-claude-remote-implementation.md). Чеклисты этого файла не выполняются дополнительно: задачи перенесены и согласованы там.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Для зависимых задач рекомендуется executing-plans.

**Goal:** Изолированное наблюдение за Claude Code в cmux через Telegram.

**Architecture:** Общий NestJS relay разделяет данные по ownerId; daemon каждого Mac подключается исходящим WSS. React Mini App использует Telegram auth. Устройства, события, replay и commands всегда проходят ownership checks.

**Tech Stack:** Node.js 22+, TypeScript, pnpm, React/Vite, NestJS/ws, Zod, PostgreSQL/pg, SQLite/better-sqlite3, Vitest, Playwright.

**Spec:** [Общая спецификация](../specs/2026-10-16-telegram-cmux-design.md). Статус: проект для проверки; подтверждён многопользовательский масштаб, остальные границы — явные допущения.

**Prerequisites:** План 01 и план integrations завершены: identity/ownership/pairing/WS auth, SessionAdapter и connector matrix проверены.

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

1. Одинаковый cwd/UUID у разных sessions или devices не смешивает историю.
2. JSONL rotate/partial UTF-8 и symlink за допустимый root не ломают reader.
3. Чужой user не получает snapshot/history/replay/notification.
4. Slow/noisy device и Mac sleep не блокируют остальных пользователей.
5. Auth expiry, logout и revoke не оставляют чужой cache в Mini App.

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

## Task 1: Общее наблюдение через адаптеры источников

Оценка: 2–3 часа. Результат: monitor нормализует sessions/events адаптеров Chat/Code/CLI/cmux; cmux snapshot применяется только к cmux branch. Дистанционная запись в monitor mode отключена.

**Files — Modify:** `apps/daemon/package.json`, `apps/daemon/src/config.ts`. **Create:** `apps/daemon/src/{main,cmux-adapter,cmux-bridge,hook-server,hook-bridge,session-registry,transcript-reader,event-store,monitor}.ts`, `apps/daemon/test/{cmux-adapter,hook-server,session-registry,transcript-reader,event-store,monitor}.test.ts`, `scripts/install-hooks.ts`, `scripts/test-install-hooks.test.ts`, `docs/local-setup.md`.

**Interfaces:** consumes protocol, authenticated relay плана 01, готовые SessionAdapter из integration plan и compatibility matrix; produces `CmuxAdapter`, `SessionRegistry`, `EventStore`, `getLocalSnapshot(): Promise<AppSnapshot>`, `selectSession(sessionId: string | null): Promise<void>`, `TranscriptReader.readNext(): Promise<HistoryMessage[]>`, `startMonitor(): Promise<{close(): Promise<void>}>`. `HistoryMessage = {id: string; role: 'user' | 'assistant'; text: string; occurredAt: number}`. CmuxAdapter реализует SessionAdapter и использует проверенные cmux методы только внутри своей ветки; source adapters из integration plan уже реализованы. Общий dispatcher в monitoring mode возвращает CAPABILITY_DISABLED для side effects.

- [ ] **Step 1 — Написать failing tests из fixtures.** Две sessions с одинаковым cwd, разными UUID и session_id остаются разными; новая SessionStart меняет generation; surface disappearance инвалидирует binding. В частности:

```ts
expect(registry.list().flatMap((s) => (s.target.kind === 'cmux' ? [s.target.surfaceId] : []))).toEqual([
  surfaceA,
  surfaceB,
]);
expect(registry.get(sessionA)?.status).toBe('idle'); // после Stop, не «вся задача выполнена»
expect(store.replay(expiredCursor)).toBe('resync_required');
expect(await reader.readNext()).toEqual([]); // неполная UTF-8/JSONL строка
```

Дополнить cases: завершение неполной строки даёт ровно одно сообщение; truncate/rotate не повторяет старые records; unknown record не рушит parser; symlink за пределы разрешённого Claude root отклонён; snapshot более 64 KiB обрезается на валидной UTF-8 границе; installer сохраняет все чужие hooks. Для hook socket проверить mode 0600, лимит input и malformed JSON.

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/daemon/test scripts/test-install-hooks.test.ts`.** Ожидается FAIL на отсутствующих daemon modules/поведении.

- [ ] **Step 3 — Реализовать наблюдение.** CmuxAdapter companion общается с отдельным cmux-bridge через local authenticated IPC; bridge запускается внутри cmux, разрешает только list/read/paste/escape, проверяет target UUID и не предоставляет arbitrary RPC. Только bridge использует transport из matrix: `net` RPC либо `execFile` с массивом args, без shell. Discovery 5 секунд, snapshot только выбранного/разрешённого target, максимум раз в секунду. Состояние и offsets сохранять локально в SQLite; EventStore хранит sequence/replay. Monitor потребляет ProviderEvent всех адаптеров. Hook bridge принимает stdin JSON и находит verified local binding по Claude session ID/локальному proof; только cmux branch добавляет унаследованные cmux UUID. Chat events не проходят через JSONL reader и не создают fictitious tools. Installer сначала делает backup и затем только добавляет собственные entries; отдельное uninstall удаляет только их. Hook telemetry локально быстро завершается и не ждёт relay. Permission bridge до плана 03 отдаёт управление локальному flow.

- [ ] **Step 4 — Запустить тесты и локальную проверку.** `pnpm exec vitest run apps/daemon/test scripts/test-install-hooks.test.ts` и `pnpm typecheck` → PASS. На двух одноразовых Code sessions сравнить target, event sequence, Stop/SessionEnd; отдельно проверить Desktop Chat inferred status и отсутствие permission/terminal capabilities. CLI/Desktop работают на Mac без cmux. Отключённый daemon не блокирует Claude; несопоставленный surface показывает unknown и не получает control capability.

- [ ] **Step 5 — Проверить checkpoint.** `docs/local-setup.md` содержит запуск общего companion отдельно и optional cmux bridge внутри cmux без `allowAll`, конфигурацию socket/разрешённых surfaces, установку и снятие hooks с backup. Запись экрана или обезличенный event trace подтверждает две разные sessions. Коммит не создавать.

## Task 2: Relay событий, history и уведомления по владельцу

Оценка: 2–3 часа. Результат: каждый пользователь получает только свои snapshots, history, replay и bot notifications; offline не смешивается между устройствами.

**Files — Create:** `apps/server/src/{event-store,session-service,notification-service}.ts`, `apps/server/test/{event-relay,notification-service}.test.ts`, `tests/integration/relay.test.ts`, `scripts/load-relay.ts`.
**Modify:** app/device gateways, daemon relay-client, protocol schemas.

**Interfaces:** consumes authenticated connection contexts из плана 01, daemon EventStore и AppSnapshot; produces `publish(ctx: DeviceContext, event: EventEnvelope): Promise<void>`, `getSnapshot(principal: Principal, deviceId: string): Promise<AppSnapshot>`, `replay(principal: Principal, deviceId: string, cursor: Cursor): Promise<EventEnvelope[] | 'resync_required'>`. `DeviceContext = {ownerId: string; deviceId: string; epoch: string}`; `Cursor = {streamId: string; seq: number}`. WS frames auth/snapshot/event/subscribe/resume/resync_required определяются Zod. Subscribe проверяет owner, выбирает один sessionId и передаёт daemon; `terminal_snapshot` event содержит TerminalSnapshot и входит в bounded replay. Session descriptors включают target.kind и capabilities; отсутствие terminalSnapshot даёт null, а не запрос read-screen для Desktop. Входящий deviceId проверяется против connection context, ownerId назначает сервер. `GET /sessions/:id/events` owner-scoped, cursor pagination 100 records/page.

- [ ] **Step 1 — Написать failing isolation/reconnect tests.** Два настоящих authenticated WS clients и два fake devices. Assertions:

```ts
await expect(getSnapshot(userB, deviceA.id)).rejects.toThrow('NOT_FOUND');
await expect(replay(userB, deviceA.id, cursorA)).rejects.toThrow('NOT_FOUND');
expect(userBReceivedEvents).toEqual([]); // device A опубликовал event
expect(await replay(userA, deviceA.id, expiredCursor)).toBe('resync_required');
expect(notificationsForB).toEqual([]); // завершился ход пользователя A
```

Cases: одинаковые cmux surface UUID у двух devices; подмена deviceId; старый connection epoch; duplicate/out-of-order event seq; stream reset; replay при relay restart; пер-device retention; noisy client queue overflow не влияет на B. Notification dedup owner/event, stale replay >60 секунд, 429 retry_after, block bot одним user, `/start` до/после login и group update.

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/server/test/event-relay.test.ts apps/server/test/notification-service.test.ts tests/integration/relay.test.ts`.** Ожидается FAIL на отсутствующей реализации.

- [ ] **Step 3 — Реализовать event routes и notifications.** SQL ownership на каждом snapshot/history/replay path, unique device/stream/seq и bounded retention 24 часа/10 000. Transactional outbox для notifications, один polling worker для bot updates, owner destination по проверенному private chat/from.id. Payload уведомления без содержимого терминала, ссылка sessionId без привилегий. Ограниченные per-device очереди и fair processing; frame limit 128 KiB, queue 256/1 MiB, overflow закрывает socket и требует resync. Offline commands не сохраняются для будущего выполнения.

- [ ] **Step 4 — Запустить tests и typecheck.** PASS. Оборвать связь одного fake device; другой продолжает получать события. Перезапустить relay с той же PostgreSQL DB: cursors восстанавливаются либо явно resync; нет cross-owner deliveries. Telegram sendMessage retry не считать exactly-once.

- [ ] **Step 5 — Проверить checkpoint.** Две независимые пары user/device проходят snapshot/history/live/replay tests; bot notification идёт только владельцу. Нагрузочный script принимает число users/devices/events и печатает latency/queue/memory без пользовательского содержимого. Коммит не создавать.

## Task 3: Mini App для наблюдения

Оценка: 2–3 часа. Результат: телефон показывает sessions, события/terminal snapshot и состояние соединения; управление пока выключено; два аккаунта видят разные данные.

**Files — Create:** `apps/mini-app/package.json`, `apps/mini-app/index.html`, `apps/mini-app/vite.config.ts`, `apps/mini-app/src/{main,App}.tsx`, `apps/mini-app/src/{telegram,transport,session-store}.ts`, `apps/mini-app/src/components/{SessionList,SessionDetail,EventFeed,TerminalSnapshot,PairDevice,DeviceSettings}.tsx`, `apps/mini-app/src/styles.css`, `apps/mini-app/test/session-store.test.ts`, `tests/e2e/monitoring.spec.ts`, `playwright.config.ts`.

**Interfaces:** consumes server frames плана 01 и задачи 2 и `AppSnapshot`; produces `reduceSessionState(state: SessionState, message: AppMessage): SessionState`, `createTransport(initData: string): AppTransport`, `AppTransport.send(command: Command): Promise<CommandResult>`. `SessionState = { snapshot: AppSnapshot | null; connection: 'connecting' | 'online' | 'offline' | 'expired'; selectedId: string | null }`; AppMessage — строгий union frames задачи 2. `AppTransport.subscribe(sessionId: string | null): Promise<void>` отправляет scoped subscribe frame; logout закрывает transport и очищает state. Production auth использует Telegram initData; fake auth доступен только внутри изолированного E2E server.

- [ ] **Step 1 — Написать failing reducer/E2E tests.** Список различает Chat/Code/CLI/cmux и две sessions с одинаковым cwd; переход в detail подписывает только выбранный target; snapshot заменяет старую generation. Assertions:

```ts
expect(next.snapshot?.sessions).toHaveLength(2);
expect(next.connection).toBe('offline'); // после device offline
await expect(page.getByText('Mac недоступен')).toBeVisible();
await expect(page.getByTestId('terminal-snapshot')).toHaveText('<script>alert(1)</script>');
```

Cases: user B открывает session A по deep link и получает «Сессия недоступна»; logout очищает cache/token и сокеты; revoke отключает своё устройство; resync очищает устаревшую ленту; неизвестная session в deep link показывает «Сессия недоступна»; auth expiry требует повторного открытия; новая запись не сбрасывает scroll читателя; медленное соединение не раздувает client buffer; экран с мобильной клавиатурой. Assertions только в test/spec файлах; в `*.stories.*` assertions запрещены.

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/mini-app/test` и `pnpm test:e2e -- tests/e2e/monitoring.spec.ts`.** Ожидается FAIL по отсутствующим экранам/поведению. E2E поднимает test relay и двух fake daemon для user A/B; у A две sessions; никакого реального терминального ввода.

- [ ] **Step 3 — Реализовать экраны и transport.** Login через initData, pairing с локальным подтверждением, выбор источника Chat/Code/CLI/cmux, список своих устройств, revoke/logout, список сессий, detail, табы событий/terminal, online/offline/last updated. Token хранить в памяти; reconnect после auth получает snapshot. Terminal — plain text без dangerouslySetInnerHTML; не интерпретировать ANSI/OSC. Использовать Telegram theme/safe area/viewport. Controls появляются в плане 03; вкладка terminal и кнопки зависят от capabilities. needs_setup/needs_restart/unsupported показываются с конкретной причиной; Desktop Chat не получает фиктивные file/tool events.

- [ ] **Step 4 — Запустить tests, typecheck и build.** `pnpm exec vitest run apps/mini-app/test`, `pnpm test:e2e -- tests/e2e/monitoring.spec.ts`, `pnpm typecheck`, `pnpm build` → PASS. Отдельно открыть Mini App на Telegram iOS и Android, проверить theme, safe area, keyboard, background/foreground reconnect.

- [ ] **Step 5 — Проверить checkpoint.** Продемонстрировать две живые одноразовые Claude sessions с телефона, новые события, отключение Mac и восстановление. Auth обходов в production build нет; тестовый login не становится публичным endpoint. Коммит не создавать.

## Handoff

После приёмки наблюдения запускать план 03. Устройства ещё read-only. На Telegram iOS/Android проверены два независимых аккаунта; невозможно получить чужие данные по deep link, history cursor и WS subscription.
