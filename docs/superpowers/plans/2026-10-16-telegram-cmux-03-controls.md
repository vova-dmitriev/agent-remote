# 03 — Remote Controls and Pilot Implementation Plan

> **Справочная версия.** Исполнять [основной план имплементации](2026-10-16-claude-remote-implementation.md). Чеклисты этого файла не выполняются дополнительно: задачи перенесены и согласованы там.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Для зависимых задач рекомендуется executing-plans.

**Goal:** Безопасно адресуемый ввод и permission decisions, затем приёмка сервиса.

**Architecture:** Общий NestJS relay разделяет данные по ownerId; daemon каждого Mac подключается исходящим WSS. React Mini App использует Telegram auth. Устройства, события, replay и commands всегда проходят ownership checks.

**Tech Stack:** Node.js 22+, TypeScript, pnpm, React/Vite, NestJS/ws, Zod, PostgreSQL/pg, SQLite/better-sqlite3, Vitest, Playwright.

**Spec:** [Общая спецификация](../specs/2026-10-16-telegram-cmux-design.md). Статус: проект для проверки; подтверждён многопользовательский масштаб, остальные границы — явные допущения.

**Prerequisites:** Планы 01, integrations и 02 завершены; compatibility probe подтвердил конкретные control capabilities. Неподдерживаемые controls не включаются.

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

1. Cross-owner command/permission не достигает dispatcher даже при валидном token другого user.
2. Claude вышел в shell или сменил generation — input disabled; остаточная terminal race явно проверена.
3. Crash после send до ack возвращает unknown и не повторяет side effect.
4. Поздний/double permission ответ не влияет на другой hook invocation.
5. Revoke/relay restart/DB failure отключают controls до подтверждённого reconnect и snapshot.

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

## Task 1: Управление, одноразовые разрешения и приёмка

Оценка: 2–3 часа. Результат: работающие controls в рамках подтверждённых capabilities; повтор/задержка не применяются к другой сессии.

**Files — Create:** `apps/daemon/src/{command-dispatcher,command-store,permission-broker}.ts`, `apps/daemon/test/{command-dispatcher,command-store,permission-broker}.test.ts`, `apps/mini-app/src/components/{PromptComposer,SessionControls,PermissionCard}.tsx`, `tests/integration/commands.test.ts`, `tests/e2e/controls.spec.ts`, `docs/{acceptance,operations}.md`, `.env.example`.
**Modify:** `apps/daemon/src/{cmux-adapter,hook-bridge,hook-server,session-registry,relay-client}.ts`, `apps/server/src/{app-gateway,device-gateway}.ts`, `apps/mini-app/src/transport.ts`, `apps/mini-app/src/App.tsx`, `apps/mini-app/src/components/SessionDetail.tsx`, protocol schemas, hook installer.

**Interfaces:** consumes all prior contracts and compatibility matrix; produces `dispatch`, `PermissionBroker` and `CommandStore.begin(command: Command): 'new' | CommandResult`, `CommandStore.finish(result: CommandResult): void`. При рестарте незавершённый begin становится unknown и не исполняется заново. Relay выводит owner из auth context и проверяет принадлежность session/device, но окончательное решение о локальном вводе принимает daemon.

- [ ] **Step 1 — Написать failing tests на адресацию, permission и crash windows.** Fixtures используют fake CmuxAdapter со spy на побочные эффекты и fake clock:

```ts
expect((await dispatch(staleGenerationCommand)).code).toBe('STALE_SESSION');
expect((await dispatch(expiredCommand)).code).toBe('EXPIRED');
expect((await dispatch(unverifiedCommand)).code).toBe('UNVERIFIED_SESSION');
expect(cmux.pasteAndSubmit).toHaveBeenCalledTimes(1); // один commandId доставлен дважды
expect(broker.resolve(oldRequestId, newGeneration, 'allow')).toBe(false);
```

Cases: unsupported capability отклоняется до обращения к адаптеру; Desktop target не перенаправляется в активный cmux surface; смена Desktop chat инвалидирует binding; user B отправляет command/permission для device/session A через HTTP/WS и получает NOT_FOUND до dispatch; daemon отклоняет target другого device; отозванный device и старый connection epoch не исполняют commands; закрытый surface; сменившийся focus; два sessions с одним cwd; prompt в running/permission state отклонён; Unicode/16 KiB byte limit; ESC/NUL/control chars отклонены; multiline paste одним payload; unknown после crash между send и ack; offline-команда не выполняется после reconnect. Permissions: два одинаковых tool/input получают разные requestId, double-click применяет решение один раз, timeout 45 секунд/локальный fallback, disconnected hook, daemon restart, allow не записывает permissions. UI не показывает успех Claude по одному dispatched ack.

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/daemon/test tests/integration/commands.test.ts` и `pnpm test:e2e -- tests/e2e/controls.spec.ts`.** Ожидается FAIL на отсутствующем dispatcher/broker/controls.

- [ ] **Step 3 — Реализовать командный путь и controls.** Per-session queue + persist-before-side-effect dedup на 24 часа. Relay назначает TTL 15 секунд, не больше оставшегося срока permission request; повтор commandId с другим payload отклоняется. Проверять identity/generation/binding/expiry непосредственно перед отправкой; prompt через SessionAdapter выбранного target; проверять capability и source binding перед dispatch. Для cmux — механизм compatibility probe плана 01; для PTY — только принадлежащий wrapper процесс; для Desktop — AX bridge без глобального ввода. Capability `prompt` выключен, если spike не разрешил риск выхода Claude в shell. interrupt — семантическая операция адаптера; raw Escape — только terminal target. Ни Chat, ни Desktop Code не получают cmux key call. Permission broker возвращает ответ конкретному синхронному hook; поздние решения отклоняет. UI показывает текст/параметры запроса и countdown, блокирует повторную отправку и различает accepted/dispatched/rejected/unknown. Feature flags `REMOTE_INPUT_ENABLED=false` и `REMOTE_PERMISSIONS_ENABLED=false` по умолчанию; включать только прошедшие локальную приёмку capabilities.

- [ ] **Step 4 — Выполнить итоговую проверку.** `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build` → PASS. На двух одноразовых реальных Claude sessions: prompt A не затрагивает B; Escape попадает в A; permission allow/deny действует один раз в B; позднее allow отклонено; sleep/wake и relay restart не повторяют ввод. Проверить завершение Claude обратно в shell, локальный одновременный ввод, потерю hooks и неизвестную версию. Если технической гарантии нет, зафиксировать ограничение и оставить соответствующий control disabled — не выдавать read-only результат за полный control MVP.

- [ ] **Step 5 — Записать приёмку и runbook.** В `docs/acceptance.md` — версии, выполненные сценарии и фактические результаты. В `docs/operations.md` — запуск общего companion без cmux и отдельного cmux bridge, restart, re-pair/revoke, secrets без реальных значений, retention, health, отключение flags, rollback hooks. Проверить, что остановка всей интеграции оставляет локальный Claude работоспособным. Изменения не коммитить.

## Task 2: Приёмка многопользовательского пилота и эксплуатация

Оценка: 4–5 часов вместе с устранением выявленных дефектов. Результат: отчёт о фактической изоляции, нагрузке и восстановлении; подготовленный выпуск пилота.

**Files — Create:** `tests/integration/tenant-isolation.test.ts`, `tests/e2e/multi-user.spec.ts`, `tests/load/relay-load.test.ts`, `docs/security-boundaries.md`, `scripts/package-daemon.ts`, `docs/install-daemon.md`.
**Modify:** `docs/{acceptance,operations}.md`, `scripts/load-relay.ts`, deployment compose/config; ошибки исправлять в соответствующем owner module с regression test.

**Interfaces:** consumes все три подпроекта; produces reproducible acceptance report с версиями/VM size/latency и runbook восстановления. Новых публичных API этот этап не добавляет.

- [ ] **Step 1 — Написать failing full-path tests.** Реальные PostgreSQL/relay, два authenticated clients, два daemon simulators. Проверить все ownership boundaries одной матрицей:

```ts
expect(await readForeignSnapshot(userB, deviceA)).toMatchObject({ code: 'NOT_FOUND' });
expect(await readForeignHistory(userB, sessionA)).toMatchObject({ code: 'NOT_FOUND' });
expect(await subscribeForeignSession(userB, sessionA)).toMatchObject({ code: 'NOT_FOUND' });
expect(await sendForeignCommand(userB, commandA)).toMatchObject({ code: 'NOT_FOUND' });
expect(await answerForeignPermission(userB, permissionA)).toMatchObject({ code: 'NOT_FOUND' });
```

Helpers используют production HTTP/WS handlers с разными настоящими auth tokens. Дополнить snapshot cache после logout A/login B, notification destination, pairing claim race, token revoke во время command, duplicate/reconnect, недопустимый session ID и одинаковые UUID на двух устройствах.

- [ ] **Step 2 — Запустить `pnpm exec vitest run tests/integration/tenant-isolation.test.ts` и `pnpm test:e2e -- tests/e2e/multi-user.spec.ts`.** Любой обнаруженный дефект воспроизвести failing test перед исправлением; если всё уже PASS, не ломать код ради искусственного RED.

- [ ] **Step 3 — Устранить дефекты и выполнить нагрузочную/аварийную проверку.** 20 users × 1 device × 10 sessions, 1 selected snapshot/user/sec, 200 events/sec суммарно, 30 минут. Цель p95 hook-to-UI ≤2 секунды при зафиксированной VM, bounded memory/queues; один noisy user не нарушает delivery другого. Проверить PostgreSQL backup/restore, relay restart, DB unavailable, daemon restart и Mac sleep/wake. После DB failure команды отклоняются до нового snapshot; неопределённые dispatch не повторяются. Backup retention ≤7 дней, SQL не логирует payload/secrets.

- [ ] **Step 4 — Выполнить полную приёмку.** `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build` → PASS. Проверка на двух реальных Telegram аккаунтах/двух Mac, iOS/Android; пройти Chat, Desktop Code, native CLI, PTY CLI и cmux отдельно; setup без ручного изменения userId на сервере. Все negative ownership tests PASS. Непроверенные capabilities остаются disabled с перечислением ограничений, не отмечаются как готовые.

- [ ] **Step 5 — Подготовить выпуск пилота.** Runbook: установка/обновление daemon из официального артефакта проекта, запуск в cmux, env без реальных secrets, revoke/logout, восстановление DB, retention, monitoring/error rate, отключение control flags и rollback hooks. Собрать versioned daemon tarball с SHA-256 checksum и CLI pair/start/hooks install/hooks uninstall и claude/claude --resume; добавить подписанный AX helper и локальную настройку Accessibility для Desktop. Проверить установку на чистом macOS user profile с Node.js 22+. Auto-update вне релиза; AX helper подписывается и проверяется отдельно, даже если JS companion поставляется tarball. До pairing UI объясняет, что видимый terminal text проходит через сервер оператора. Фактический публичный запуск согласуется после review результата; в рамках текущего запроса только план. Коммит не создавать.

## Handoff

Перед исполнением пользователь проверяет этот план вместе со spec. Рекомендуемый метод — executing-plans последовательно; обязательная финальная проверка всего сервиса, source capabilities и ownership boundaries перед выпуском. Сам план не подтверждает, что приложение уже реализовано или прошло приёмку.
