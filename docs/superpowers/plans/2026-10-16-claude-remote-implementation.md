# Claude Remote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Не создавать коммиты.

**Goal:** Многопользовательский Telegram Mini App для наблюдения и управления выбранными Claude Desktop Chat/Code, CLI и cmux sessions на Mac пользователя.

**Architecture:** Свой NestJS relay с PostgreSQL и owner-scoped API; локальный Node.js companion подключается исходящим WSS. Переиспользуем конкретные MIT-компоненты вместо целых single-user приложений: собственный React UI, подходы Code hooks/PTY CCGram, вызовы cmux из cmux-tui. Desktop Chat/Code UI обслуживает отдельный Swift Accessibility helper; возможности каждого источника проверяются и отражаются в протоколе.

**Tech Stack:** Node.js 22+, TypeScript strict/ESM, pnpm workspaces, React/Vite, NestJS/ws, PostgreSQL/pg, SQLite/better-sqlite3, Zod, node-pty, Swift/AXUIElement, Vitest, Playwright.

**Spec:** [Сервис](../specs/2026-10-16-telegram-cmux-design.md), [адаптеры](../specs/2026-10-16-claude-connectors-design.md), [оценка с AI](../../delivery-estimate.md), [source review](../../research/2026-10-16-alternatives-and-reuse.md).

**Status:** По последующему явному запросу пользователя реализован полный локальный стек: protocol, relay/auth/pairing/ownership, WebSocket/events/commands/notifications, companion/hooks/JSONL/PTY/cmux, React Mini App, Swift AX helper, packaging и эксплуатационные скрипты. Выполнен один финальный review/fix pass. Фактические проверки и открытые внешние gates — в [приёмке](../../acceptance.md). Desktop Chat/Code пока не прошли real-app gate, поэтому полный пилот не считается принятым. Исходные checkbox ниже — последовательность проектирования, не автоматическое свидетельство приёмки.

## Global Constraints

- Репозиторий `/absolute/path/claude-remote`; все пути ниже относительны его корню. Коммиты не выполнять; токены, initData и реальные чаты в Git не сохранять.
- macOS first; несколько изолированных пользователей; пилот 1 active Mac/user, 10 sessions/device, 20 simultaneous users. cmux optional. Обычный CLI без PTY не получает фиктивный idle stdin; Chat не получает Code tool events.
- Identity: ownerId из auth context; Target.kind + deviceId + connectorId + source-specific IDs + generation. Чужой resource → NOT_FOUND. Нет fallback на active terminal/chat, произвольного shell/AX selector RPC и автоматического allow.
- Snapshot 200 строк/64 KiB/1 секунда; discovery 5 секунд; JSONL line 1 MiB; prompt 16 KiB UTF-8; command TTL 15 секунд; dedup 24 часа; event retention 24 часа/10 000 на device.
- Heartbeat 10 секунд/offline 30 секунд; initData max age 300 секунд/future skew 30 секунд; app token 15 минут; WS auth deadline 5 секунд; pairing code 128 бит/5 минут; permission wait 45 секунд/hook timeout 60 секунд.
- Frame 128 KiB; queue 256 frames/1 MiB; 30 commands/min/user, 10 auth/min/IP, 5 pairing attempts/min/IP и user; backup retention 7 дней. Результат unknown не повторяется автоматически.
- Desktop требует локального Accessibility consent, unlocked Mac, verified chat binding и пустого composer. Нет private APIs, cookies, скрытого Screen Recording/OCR или development channel bypass в штатной установке.

## Review Focus

1. Два владельца/источника с одинаковыми session IDs/title/cwd: list/history/live/replay/commands/permissions/notifications остаются изолированными — tasks 2, 3, 8, 9, 11, 12.
2. Child exit, переключение Desktop chat/account, local draft и lock screen: ввод прекращается до побочного эффекта — tasks 1, 5, 6, 11.
3. Потеря ack между send и crash: один commandId не создаёт повторного ввода — tasks 10, 11, 12.
4. Partial UTF-8 JSONL, rotate/truncate, symlink вне Claude root и смена generation: reader восстанавливается, binding не угадывается — tasks 7, 8.
5. Delayed permission, reconnect старого socket epoch, revoke и медленный/noisy клиент: нет чужого решения, отложенного ввода или неограниченной очереди — tasks 3, 9, 11, 12.

## Решение по upstream

Берём модули, не форкаем всю runtime/auth архитектуру. HAPI/Happy остаются справочными альтернативами, их установка не блокирует этот путь. Если выбранный MIT-модуль не подходит, task 0 фиксирует конкретную замену и её стоимость; не начинать новый широкий поиск.

| Upstream / pin                                               | Что адаптировать                                                                                                                                                             | Куда                          | Что исключить                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `rennf93/cc-tg-hub@f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099` | `app/src/components/ui.tsx`, `app/src/pages/{SessionsPage,SessionDetail}.tsx`, `app/src/lib/telegram/{hooks,theme,webapp}`, `globals.css` и прямые локальные UI dependencies | `apps/mini-app/src/`          | Shared operator auth/state, development channel transport, смысл Stop=disconnect; transcript/composer добавляем сами    |
| `jsayubi/ccgram@75b38e1bab4af411b40b4e589d050786eb65ceca`    | `src/utils/pty-session-manager.ts`, `src/utils/transcript-reader.ts`, сериализация результата из `permission-hook.ts`                                                        | `apps/daemon/src/{cli,code}/` | Raw output logs, name/cwd identity, kill-on-name-collision, Always/Defer, Telegram polling внутри hooks                 |
| `W4M-ai/cmux-tui@bb0fea83d2fcdb5f172e651cf0f4d81a37329eb8`   | cmux command wrapper/проверенные вызовы из `src/index.ts`                                                                                                                    | `apps/daemon/src/cmux/`       | OpenTUI, Bun runtime dependency, workspace refs/current focus, macros approve y/Enter, эвристика статуса как разрешение |

Для каждого перенесённого файла сохранить copyright/MIT notice, pinned source path и описание изменений в THIRD_PARTY_NOTICES.md. Не переносить код официального cmux remote PR, HAPI server или неизвестно лицензированный dependency вместе с этими MIT-модулями.

## Структура и команды

| Путь                                                                     | Ответственность                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/{types,schemas,frames,index}.ts`                  | Public wire contract v1, строгие Zod schemas и shared types                                          |
| `apps/server/src/{auth,devices,sessions,events,commands,notifications}/` | Owner-aware relay; `db/` — SQL migrations/repositories                                               |
| `apps/daemon/src/{adapters,cli,code,cmux,desktop,monitor,commands}/`     | Локальные bindings, adapters, hooks/JSONL, outbox/dedup; `main.ts`/`setup-cli.ts` — запуск/настройка |
| `apps/mini-app/src/{api,store,components,pages,lib/telegram}/`           | Telegram auth/UI и capability-aware controls                                                         |
| `apps/macos-helper/`, `tools/ax-probe/`, `scripts/`, `tests/`, `docs/`   | Desktop helper, диагностический probe, provenance/packaging, проверки и runbook                      |

Root scripts: `pnpm test` → `vitest run`; `pnpm typecheck` → TS всех workspaces; `pnpm build` → protocol/server/daemon/mini-app; `pnpm test:e2e` → Playwright с локальным test relay; SQL migrations выполняются автоматически при старте relay. `compose.test.yml` поднимает временный PostgreSQL: `docker compose -f compose.test.yml up -d --wait`. Реальные credentials не нужны для unit/integration тестов. Native checks: `swift test --package-path apps/macos-helper`; signed release helper проверяется отдельно.

В test examples typed fixtures и spies создаются в test setup; `clientA/clientB` из server-harness выполняют реальные HTTP/WS requests разных principals. Они не являются новыми production API.

Общий цикл каждой task: написать указанный behavior test → увидеть ожидаемый FAIL → реализовать → тот же тест PASS + typecheck затронутого workspace. Не писать assertions в Storybook. Setup включать в task, которой он нужен. Коммит не является шагом.

## Общие интерфейсы

Типы Target, Session, CapabilitySet, EventEnvelope, Command/Action/CommandResult, PendingPermission, SessionAdapter/Binding/ProviderEvent — строго из spec, экспорт `@remote/protocol`. Все даты epoch milliseconds, кроме Telegram auth_date в seconds.

`Principal = {userId: string; telegramId: string}`; server ownerId = Principal.userId. `DeviceContext = {ownerId: string; deviceId: string; epoch: string}`. Device/app token audiences разделены. Scope queries по ownerId обязательны даже после успешного login.

`ClientCommand = Omit<Command, 'version' | 'expiresAt'>`; браузер отправляет commandId/target/sessionId/generation/action, relay добавляет version 1 и expiresAt. Browser frames: auth, subscribe, resume, command; server frames: snapshot, event, resync_required, command_result; payloads — строгие schemas. До auth нет подписок.

`Cursor = {streamId: string; seq: number}`; `TerminalSnapshot = {sessionId: string; generation: string; text: string; capturedAt: number}`; `AppSnapshot = {sessions: Session[]; deviceStatus: 'online' | 'offline'; cursor: Cursor; permissions: PendingPermission[]; terminal: TerminalSnapshot | null}`.

`AdapterRegistry.register(adapter: SessionAdapter): void`, `resolve(target: Target): SessionAdapter`, `list(): ConnectorDescriptor[]`; descriptor и методы SessionAdapter — из adapter spec. Не привязывать source kind к наличию cmux binary.

`PermissionBroker.open(request: PendingPermission): Promise<'allow' | 'deny' | 'local'>`, `resolve(requestId: string, generation: string, decision: 'allow' | 'deny'): boolean`; ответ связан с конкретным живым hook invocation. `local` не выдаёт allow.

## Task 0: Зафиксировать переносимые модули и рабочий scaffold — 2–4 часа

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `packages/protocol/package.json`, `scripts/import-upstream.ts`, `upstream.lock.json`, `THIRD_PARTY_NOTICES.md`, `tests/upstream/import.test.ts`, `docs/upstream-validation.md`.

**Interfaces:** consumes существующий `docs/research/2026-10-16-upstream-revisions.json`; produces `importUpstream(lockPath: string): Promise<ImportManifest>`, `ImportManifest = {repository: string; revision: string; source: string; destination: string; sha256: string}[]`. CLI: `pnpm upstream:import --check` проверяет lock/notices, не запускает upstream setup scripts. Lock разрешает только три pinned MIT upstream из таблицы.

- [ ] **1. Test setup:** создать минимальные package/workspace/Vitest configs и установить только test/tooling dependencies, чтобы RED проверял поведение, а не отсутствие runner. Написать `import_rejects_unpinned_revision`, `import_keeps_mit_notice`, `import_uses_explicit_allowlist`: tag main/latest, отсутствующая лицензия и файл вне allowlist отклоняются; checksum/destination записаны. В test fixture использовать локальный мини-репозиторий, не сеть.

```ts
await expect(importUpstream(unpinnedLockPath)).rejects.toThrow('UNPINNED_REVISION');
expect(manifest.every((file) => /^[0-9a-f]{40}$/.test(file.revision))).toBe(true);
expect(noticesText).toContain('MIT License');
```

- [ ] **2. RED:** `pnpm exec vitest run tests/upstream/import.test.ts` → FAIL на отсутствующем importer.
- [ ] **3. Implement:** создать минимальный workspace/runner, проверить лицензии конкретных source files, адаптировать выбранный UI/PTY/cmux слой в отдельных последующих tasks. `upstream.lock.json` сначала содержит фактический список файлов/хешей; direct local imports UI включать явно, не копировать весь репозиторий. Lock не превращать в автоматическое исполнение install hooks.
- [ ] **4. GREEN:** тот же test и `pnpm upstream:import --check` → PASS. Изолированный upstream smoke с тестовой CLI-сессией/телефоном записывает фактический transport и ограничения; исходные Claude configs предварительно сохраняются, основной профиль не перезаписывается.
- [ ] **5. Checkpoint:** `docs/upstream-validation.md` фиксирует перенесённые части, необходимые adaptations и фактическое время. Source review не повторяется целиком. Первый демо 4–8 часов — upstream smoke + первичный probe, он не означает готовый multi-user backend.

<a id="platform"></a>

## Task 1: Проверить Desktop/CLI/cmux и закрепить contracts — 2–3 часа

**Files:** Create `packages/protocol/src/{types,schemas,frames,index}.ts`, `packages/protocol/test/schemas.test.ts`, `tools/ax-probe/Package.swift`, `tools/ax-probe/Sources/AXProbe/main.swift`, `scripts/probe-sources.ts`, `tests/fixtures/{claude,cmux,desktop}/`, `docs/compatibility.md`.

**Interfaces:** produces `targetSchema`, `commandSchema`, `eventSchema`, `sessionSchema`, `frameSchema` и types общего контракта; diagnostic `probeSources(): Promise<ProbeResult[]>`, `ProbeResult = {kind: Target['kind']; version: string; capability: keyof CapabilitySet; outcome: 'pass' | 'fail' | 'needs_setup'; reason: string}`.

- [ ] **1. Test:** `targets_are_discriminated`: CLI/Chat targets без cmux UUID допустимы; focused/current/extra fields и protocol version 2 отклонены. `prompt_limit_is_utf8_bytes`: 16 KiB допустимы, 16 KiB+1 и ESC/NUL/CR запрещены.

```ts
expect(targetSchema.safeParse(cliTargetWithoutCmuxIds).success).toBe(true);
expect(targetSchema.safeParse({ ...cmuxTarget, surfaceId: 'focused' }).success).toBe(false);
expect(commandSchema.safeParse(oversizedUtf8PromptCommand).success).toBe(false);
```

- [ ] **2. RED:** `pnpm exec vitest run packages/protocol/test/schemas.test.ts` → FAIL на отсутствующих schemas.
- [ ] **3. Implement/probe:** реализовать schemas; реальный AX probe в одноразовых Chat и Code проверяет read/composer/send/Stop и стабильную chat identity. На одноразовом CLI проверить hooks load/SessionStart/session_id/transcript_path и permission fallback; cmux проверять только если установлен, без allowAll. Локальное consent делает пользователь. Записывать версии и обезличенные результаты, не весь AX dump.
- [ ] **4. GREEN:** schemas tests и typecheck → PASS; в compatibility.md есть отдельный outcome по каждому source/operation. Проверить два одинаковых chat title и navigation. Наличие read text без привязки выбранного чата не считается успешным send transport.
- [ ] **5. Gate:** если Chat AX не даёт verified read+send, зафиксировать невыполненное требование и пересмотреть Desktop transport до основной реализации. CLI/cmux могут разрабатываться независимо, но весь заявленный объём Chat не отмечать готовым. Долгое исследование не прятать в лимит 2–3 часа.

## Task 2: Telegram auth и ownership — 2–4 часа

**Files:** Create `apps/server/package.json`, `apps/server/src/{main,config}.ts`, `apps/server/src/auth/{telegram,auth-service,guard}.ts`, `apps/server/src/db/{connection,migrate}.ts`, `apps/server/src/db/migrations/001_initial.sql`, `apps/server/test/auth.test.ts`, `tests/integration/ownership.test.ts`, `tests/helpers/server-harness.ts`, `compose.test.yml`.

**Interfaces:** `login(rawInitData: string, now: number): Promise<{token: string; expiresAt: number}>`, `authenticate(token: string, now: number): Promise<Principal>`, `requireOwnedDevice(principal: Principal, id: string): Promise<DeviceRecord>`, `logout(token: string): Promise<void>`; `DeviceRecord = {id: string; ownerId: string; tokenHash: string; generation: string; revokedAt: number | null}`. HTTP POST `/auth/telegram`, `/auth/logout`.

- [ ] **1. Test:** `login_validates_signature_time_and_user`, `same_telegram_id_is_one_user`, `foreign_device_is_not_found`: поддельная подпись, missing user, age 301s и future 31s → UNAUTHORIZED; expiry = now+900000; userB/deviceA → NOT_FOUND. Assert-код:

```ts
expect((await login(validInitDataA, now)).expiresAt).toBe(now + 900_000);
await expect(login(expiredInitData, now)).rejects.toThrow('UNAUTHORIZED');
await expect(requireOwnedDevice(userB, deviceA.id)).rejects.toThrow('NOT_FOUND');
```

- [ ] **2. RED:** поднять test DB; `pnpm exec vitest run apps/server/test/auth.test.ts tests/integration/ownership.test.ts` → behavior FAIL.
- [ ] **3. Implement:** PostgreSQL users/auth_sessions/devices/pairings/sessions/events/command_audit/notification_destinations/outbox; unique telegramId, token hashes и composite owner/device FK. SQL queries принимают Principal, не userId из request body. Список чужих resources не раскрывать; bigint Telegram IDs хранить string.
- [ ] **4. GREEN:** те же tests, migration на пустой DB и повторный migration run → PASS. Добавить concurrent login, logout/revocation и cross-owner insert rejection. Не переносить shared allowUserIds auth cc-tg-hub.
- [ ] **5. Checkpoint:** два независимых authenticated principals; tokenA не превращается в userB от query/body; secrets не попадают в logs.

## Task 3: Pairing и app/device connections — 2–3 часа

**Files:** Create `apps/server/src/devices/{pairing,device-service,gateway}.ts`, `apps/server/src/auth/app-gateway.ts`, `apps/daemon/package.json`, `apps/daemon/src/{config,main,setup-cli,relay-client}.ts`, `apps/server/test/pairing.test.ts`, `apps/daemon/test/relay-client.test.ts`, `tests/integration/connections.test.ts`.

**Interfaces:** `claimPairing(principal: Principal, code: string): Promise<{claimId: string}>`, `confirmPairing(proof: string, claimId: string, approved: boolean): Promise<{deviceId: string; token: string} | null>`, `revokeDevice(principal: Principal, id: string): Promise<void>`. POST `/device/pair/start`, `/pair/claim`, `/device/pair/status`, `/device/pair/confirm`; GET `/devices`, DELETE `/devices/:id`; WS `/ws/app` and `/ws/device`.

- [ ] **1. Test:** `pairing_is_single_use`, `quota_is_transactional`, `revoke_fences_old_socket`: два claims одного code имеют одного победителя; local decline/expiry/wrong proof не выдаёт token; app/device tokens невзаимозаменяемы; после revoke старый epoch не доставляет events/commands.

```ts
expect(await confirmPairing(wrongProof, claimId, true)).toBeNull();
await expect(revokeDevice(userB, deviceA.id)).rejects.toThrow('NOT_FOUND');
expect(oldEpochDeliveredFrames).toEqual([]);
```

- [ ] **2. RED:** `pnpm exec vitest run apps/server/test/pairing.test.ts apps/daemon/test/relay-client.test.ts tests/integration/connections.test.ts` → FAIL.
- [ ] **3. Implement:** 128-bit code/TTL 5min, отдельный proof, локальное подтверждение Telegram ID и transactional quota lock. Только daemon получает device token; local file 0600, server hash. First WS auth ≤5s, Origin allowlist, token expiry, один epoch/device, heartbeat/offline/reconnect из global constraints; rate limits до дорогой обработки.
- [ ] **4. GREEN:** те же tests + fake clock expiry, reconnect нового socket до close старого и disconnect/revoke pending requests → PASS. До auth нет frames с пользовательскими данными; secret не в URL.
- [ ] **5. Checkpoint:** два владельца видят свои devices; CLI pair/start не зависит от cmux. Companion имеет только исходящий WSS, public Mac port отсутствует.

<a id="adapters"></a>

## Task 4: SessionAdapter и source routing — 1–2 часа

**Files:** Create `apps/daemon/src/adapters/{registry,errors}.ts`, `apps/daemon/test/adapters/registry.test.ts`; Modify protocol exports.

**Interfaces:** SessionAdapter/Binding/ConnectorDescriptor из spec; `AdapterError(code: string)`; AdapterRegistry register/resolve/list из общих интерфейсов. `resolve` валидирует current binding и connector/device/kind; registry не принимает owner со стороны UI.

- [ ] **1. Test:** `routes_by_source_identity`, `missing_cmux_is_not_fatal`, `capability_rejected_before_side_effect`: одинаковые title/cwd остаются разными; чужой connector → NOT_FOUND; unavailable prompt → AdapterError, spy send calls = 0.

```ts
expect(() => registry.resolve(foreignConnectorTarget)).toThrow('NOT_FOUND');
await expect(disabledAdapter.sendPrompt(binding, 'test')).rejects.toThrow('CAPABILITY_UNAVAILABLE');
expect(sideEffectSpy).not.toHaveBeenCalled();
```

- [ ] **2. RED:** `pnpm exec vitest run apps/daemon/test/adapters/registry.test.ts` → FAIL.
- [ ] **3. Implement:** registry с explicit descriptors/capabilities/setup reason. Запретить fallback на active chat/surface; localProof не покидает Mac. Unverified binding доступен только для разрешённого наблюдения.
- [ ] **4. GREEN:** те же tests + typecheck → PASS; четыре Target branches принимаются без фиктивных cmux IDs.
- [ ] **5. Checkpoint:** source drivers подключаются через один interface; отсутствие optional binary/permission не выключает companion целиком.

## Task 5: Native CLI и PTY passthrough — 2–3 часа

**Files:** Create `apps/daemon/src/cli/{native-adapter,pty-adapter,pty-session,wrapper}.ts`, `apps/daemon/test/cli.test.ts`, `tests/integration/pty.test.ts`, `apps/daemon/bin/remote.mjs`, `apps/daemon/src/code/{hook-bridge,hook-server}.ts`, `scripts/install-hooks.ts`, `docs/connect-terminal.md`. Скелет hook bridge здесь поддерживает telemetry/SessionStart; permission decision transport добавляется в task 11.

**Interfaces:** NativeCliAdapter/PtyCliAdapter implement SessionAdapter; `startClaude(argv: string[], terminal: {stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream}): Promise<{sessionId: string; closeRemoteBinding(): void}>`. Local commands `remote claude`, `remote claude --resume <session-id>`; `remote pair/start` из task 3. Remote API не вызывает startClaude.

- [ ] **1. Test:** `native_cli_has_no_idle_stdin`, `pty_exit_invalidates_binding`, `local_terminal_survives_relay_disconnect`: native capabilities.prompt=false; PTY child exit → STALE_SESSION и no write; local stdin/stdout/resize работают при отключённом relay; resume передаёт один явный session ID.

```ts
expect(nativeAdapter.descriptor().capabilities.prompt).toBe(false);
await expect(ptyAdapter.sendPrompt(exitedBinding, 'test')).rejects.toThrow('STALE_SESSION');
expect(resumeSpawnArgs).toEqual(['--resume', claudeSessionId]);
```

- [ ] **2. RED:** `pnpm exec vitest run apps/daemon/test/cli.test.ts tests/integration/pty.test.ts` → FAIL.
- [ ] **3. Implement:** адаптировать spawn/onExit/write из pinned CCGram с node-pty; добавить local passthrough, authenticated registration, fixed Claude executable и parser аргументов. Не копировать raw logs, kill существующего child по name и unknown key pass-through. Локальный hook socket 0600/bridge и backup+merge installer реализовать здесь, до реального PTY probe; один SessionStart создаёт authenticated binding. Binding появляется только после SessionStart; external TTY не перехватывается. Native hooks-only mode не обещает input.
- [ ] **4. GREEN:** tests/typecheck и Terminal.app/iTerm2 с двумя одноразовыми sessions → PASS; multiline prompt/Unicode/resize/local Ctrl-C, child exit и companion crash не переводят remote input в shell. Явный resume не работает одновременно с прежним frontend.
- [ ] **5. Checkpoint:** одна рабочая управляемая CLI-сессия без cmux; инструкция различает native observation и managed control. Этот result не заменяет приёмку Desktop.

## Task 6: Desktop Chat/Code helper — 4–7 часов при положительном probe

**Files:** Create `apps/macos-helper/Package.swift`, `apps/macos-helper/Sources/ClaudeBridge/{Main,Protocol,Bindings,AccessibilityClient,ChatDriver,CodeDriver}.swift`, `apps/macos-helper/Tests/ClaudeBridgeTests/{BindingTests,DraftTests}.swift`, `apps/daemon/src/desktop/{bridge-client,chat-adapter,code-adapter}.ts`, `apps/daemon/test/desktop.test.ts`, `apps/macos-helper/Resources/{Info.plist,ClaudeBridge.entitlements}`, `scripts/build-macos-helper.ts`, `docs/connect-desktop.md`. Сборка helper имеет стабильный CFBundleIdentifier для локального Accessibility consent.

**Interfaces:** `bind(mode: 'chat' | 'code'): Promise<Binding>` вызывается только локальным setup; DesktopChatAdapter/DesktopCodeAdapter implement SessionAdapter. Narrow IPC bind/read/send_prompt/interrupt/unbind с opaque bindingId/generation; PID/selectors/coordinates не принимаются от relay. Code hook/UI identity объединяется только по проверенному session ID binding.

- [ ] **1. Test:** `changed_chat_invalidates_binding`, `local_draft_is_preserved`, `chat_never_has_code_permissions`: смена chat/account/window/app restart → STALE_SESSION; непустой composer → LOCAL_DRAFT_PRESENT; Chat permission/terminalSnapshot=false; lock/missing consent → CAPABILITY_UNAVAILABLE.

```ts
await expect(chatAdapter.sendPrompt(changedBinding, 'test')).rejects.toThrow('STALE_SESSION');
await expect(chatAdapter.sendPrompt(bindingWithDraft, 'test')).rejects.toThrow('LOCAL_DRAFT_PRESENT');
expect(chatAdapter.descriptor().capabilities.permission).toBe(false);
```

- [ ] **2. RED:** `swift test --package-path apps/macos-helper` и `pnpm exec vitest run apps/daemon/test/desktop.test.ts` → FAIL.
- [ ] **3. Implement:** AX helper только для выбранного Claude chat; targeted AX set/press, проверки перед send и unknown при неопределённом результате. Нет global typing/paste, private debugging API и сканирования остальных чатов. Code получает hooks; Chat — только доступные UI messages с inferred status. Native helper signing/entitlements и clean-profile установка входят в эту task; ожидание signing credentials отдельно.
- [ ] **4. GREEN:** Swift/TS tests + реальный Chat→Code→Chat, два одинаковых title/два окна, local draft, lock/unlock, concurrent local edit → PASS в поддерживаемых условиях. Сохранить версии и границы AX; binding только по title/focus не принимается.
- [ ] **5. Gate:** read+prompt работают именно в существующем выбранном чате и не меняют соседний. Если нет — source остаётся unsupported/needs_setup с конкретной причиной, исходное требование Chat остаётся открытым, способ интеграции пересматривается.

## Task 7: Hooks, cmux bridge и connector lifecycle — 1 час

**Files:** Create `apps/daemon/src/cmux/{client,bridge,adapter}.ts`, `apps/daemon/src/adapters/connector-service.ts`, `apps/daemon/test/connectors.test.ts`, `scripts/install-hooks.test.ts`; Modify `apps/daemon/src/code/{hook-bridge,hook-server}.ts`, `scripts/install-hooks.ts`, daemon bootstrap/setup из tasks 3/5.

**Interfaces:** `listConnectors(): ConnectorDescriptor[]`, `connectSource(kind: Target['kind']): Promise<ConnectorDescriptor>`, `disconnectSource(connectorId: string): Promise<void>`; HookEnvelope from spec; CmuxAdapter implements SessionAdapter for cmux branch only. `readScreen(target: Extract<Target,{kind:'cmux'}>): Promise<string>` — internal driver primitive.

- [ ] **1. Test:** `optional_cmux_bridge_does_not_affect_cli`, `installer_preserves_other_hooks`, `cmux_target_is_explicit`: отключение cmux не трогает CLI/Desktop; install/uninstall меняет только свои entries; вызов содержит явные UUID, no focused fallback.

```ts
expect(afterDisconnectCli.capabilities).toEqual(beforeDisconnectCli.capabilities);
expect(cmuxSpawnArgs).toEqual(expect.arrayContaining(['--surface', target.surfaceId]));
expect(unrelatedHookEntriesAfterInstall).toEqual(unrelatedHookEntriesBeforeInstall);
```

- [ ] **2. RED:** `pnpm exec vitest run apps/daemon/test/connectors.test.ts scripts/install-hooks.test.ts` → FAIL.
- [ ] **3. Implement:** port cmux wrapper из pinned cmux-tui с Bun.spawn на Node execFile(args), без shell; JSON/UUID output из probe вместо ref/title parsing. Bridge запускается внутри cmux при cmux-only, общается с companion по аутентифицированному local socket 0600; allowAll не включать. Hooks IPC общий для Code sources, installer сначала backup/merge; UI helper permission только локально.
- [ ] **4. GREEN:** те же tests/typecheck; две cmux surfaces с одинаковым cwd, cmux stop и Mac без cmux → PASS. Если adaptation/bridge не помещается в 1 час, фактическое превышение записать и использовать общий резерв, не удалять проверки.
- [ ] **5. Checkpoint:** четыре источника зарегистрированы независимо; неопределённый native CLI binding показывает needs_restart, а не guessed session.

<a id="monitoring"></a>

## Task 8: Единый monitor и история — 2–3 часа

**Files:** Create `apps/daemon/src/code/transcript-reader.ts`, `apps/daemon/src/monitor/{session-registry,event-store,monitor}.ts`, `apps/daemon/test/monitor.test.ts`, `apps/daemon/test/transcript-reader.test.ts`.

**Interfaces:** `ingestHook(input: HookEnvelope): EventEnvelope[]`, `getLocalSnapshot(): Promise<AppSnapshot>`, `selectSession(id: string | null): Promise<void>`, `EventStore.append(event: EventEnvelope): void`, `replay(cursor: Cursor): EventEnvelope[] | 'resync_required'`, `prune(now: number): void`. `HistoryMessage = {id: string; role: 'user' | 'assistant'; text: string; occurredAt: number}`; `TranscriptReader.readNext(): Promise<HistoryMessage[]>`.

- [ ] **1. Test:** `partial_utf8_yields_one_message`, `rotation_preserves_consistency`, `foreign_realpath_is_rejected`, `source_statuses_are_not_conflated`: неполная строка → [], завершение → одно сообщение; unknown schema не рушит reader; Chat inferred status не создаёт Code Stop/tool event; новый SessionStart меняет generation.

```ts
expect(await reader.readNext()).toEqual([]); // файл заканчивается неполной UTF-8/JSONL строкой
expect(store.replay(expiredCursor)).toBe('resync_required');
expect(chatSession.statusConfidence).toBe('inferred');
```

- [ ] **2. RED:** `pnpm exec vitest run apps/daemon/test/monitor.test.ts apps/daemon/test/transcript-reader.test.ts` → FAIL.
- [ ] **3. Implement:** адаптировать только нужный JSONL parsing из CCGram; использовать hook-provided transcript_path после realpath allowlist, не findLatestTranscript(cwd). Offset/UTF-8 partial buffer/truncate/rotate/1 MiB limit; SQLite events/cursor/streamId/retention. Monitor принимает ProviderEvent всех adapters, discovery 5s, выбранный terminal snapshot ≤1Hz/200 lines/64KiB; неизменный повтор не слать.
- [ ] **4. GREEN:** tests/typecheck, два одинаковых cwd, generation change, cursor старше retention → resync_required; file/tool outputs и hidden reasoning не выгружаются; snapshot у Chat=null.
- [ ] **5. Checkpoint:** работающие snapshots и event stream для всех verified sources; Stop означает конец хода, SessionEnd — сессию, output text не превращается в инструкцию/permission.

## Task 9: Relay событий, replay и уведомления — 2–3 часа

**Files:** Create `apps/server/src/sessions/{service,controller}.ts`, `apps/server/src/events/{store,service}.ts`, `apps/server/src/notifications/{telegram,outbox}.ts`, `apps/server/test/events.test.ts`, `apps/server/test/notifications.test.ts`; Modify both gateways, daemon relay-client; Create `tests/integration/replay.test.ts`.

**Interfaces:** `publish(ctx: DeviceContext, event: EventEnvelope): Promise<void>`, `getSnapshot(principal: Principal, deviceId: string): Promise<AppSnapshot>`, `replay(principal: Principal, deviceId: string, cursor: Cursor): Promise<EventEnvelope[] | 'resync_required'>`. GET `/sessions/:id/events` cursor pagination 100 records; owner-scoped subscription and snapshot; `GET /devices/:id/connectors` exposes only own descriptors.

- [ ] **1. Test:** `foreign_subscribe_history_replay_are_not_found`, `epoch_fences_stale_device`, `noisy_owner_does_not_starve_other`, `notifications_follow_owner`: B не получает ни snapshot/history/live A, один offline transition → одно уведомление; replay старше 60s без старого notification; blocked bot влияет только на свой owner.

```ts
await expect(getSnapshot(userB, deviceA.id)).rejects.toThrow('NOT_FOUND');
await expect(replay(userB, deviceA.id, cursorA)).rejects.toThrow('NOT_FOUND');
expect(userBReceivedEventsFromA).toEqual([]);
```

- [ ] **2. RED:** `pnpm exec vitest run apps/server/test/events.test.ts apps/server/test/notifications.test.ts tests/integration/replay.test.ts` → FAIL.
- [ ] **3. Implement:** owner-scoped PostgreSQL events и уникальность device/stream/seq, bounded snapshot/replay; queue overflow → disconnect/resync. Один bot polling worker, private /start from.id→owner, outbox dedup/429 retry_after, global/per-chat limiter; no raw terminal text в notification. Relay restart восстанавливает DB state и reauth.
- [ ] **4. GREEN:** те же tests/typecheck; stream reset, cursor gap, slow client, одинаковые cmux IDs у A/B, замена socket epoch и relay restart → PASS. Offline команды не копить.
- [ ] **5. Checkpoint:** два владельца видят разные live/history/notifications; code/text payload не пишет secrets в logs; trusted owner определяется connection context, не event body.

## Task 10: Mini App и транспорт команд — 2–3 часа

**Files:** Create/adapt `apps/mini-app/package.json`, `apps/mini-app/src/{main,App}.tsx`, `apps/mini-app/src/api/{client,transport}.ts`, `apps/mini-app/src/store/sessions.ts`, `apps/mini-app/src/pages/{SessionsPage,SessionDetail}.tsx`, `apps/mini-app/src/components/{PromptComposer,PermissionCard,PairDevice,DeviceSettings}.tsx`, `apps/mini-app/src/lib/telegram/`, `apps/mini-app/test/store.test.ts`, `tests/e2e/monitoring.spec.ts`, `playwright.config.ts`; Modify source UI listed in upstream map.

**Interfaces:** `createTransport(initData: string): AppTransport`, `AppTransport.subscribe(sessionId: string | null): Promise<void>`, `send(command: ClientCommand): Promise<CommandResult>`, `close(): void`; `reduceSessionState(state: SessionState, message: AppMessage): SessionState`, `SessionState = {snapshot: AppSnapshot | null; connection: 'connecting' | 'online' | 'offline' | 'expired'; selectedId: string | null}`, AppMessage = typed server frames. Production auth never uses test identity.

- [ ] **1. Test:** `logout_clears_previous_owner`, `resync_replaces_snapshot`, `capabilities_gate_controls`, `terminal_is_plain_text`: B after logout A видит только своё; Chat без terminal/permission UI; offline/stale/expired blocks send; `<script>` остаётся текстом; scroll history не сбрасывается при новом event.

```ts
expect(next.snapshot?.sessions.every((s) => s.target.deviceId === deviceB.id)).toBe(true);
await expect(page.getByTestId('terminal-snapshot')).toHaveText('<script>alert(1)</script>');
await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled(); // offline
```

- [ ] **2. RED:** `pnpm exec vitest run apps/mini-app/test/store.test.ts`; `pnpm test:e2e -- tests/e2e/monitoring.spec.ts` → FAIL. Harness поднимает test relay/PostgreSQL и fake adapters для двух владельцев.
- [ ] **3. Implement:** перенести pinned UI/Telegram theme/haptics, заменить API contract и добавить live feed/composer/permission/setup. Показать Chat/Code/CLI/cmux, last updated и конкретный setup reason; auth token только memory; suspend/background→reauth/resync. Stop upstream переименовать/разделить на disconnect и semantic interrupt; никакого скрытого kill. Client commandId сохранять при retry/status lookup, unknown не пересылать автоматически.
- [ ] **4. GREEN:** tests/typecheck/build; iOS/Android Telegram viewport/theme/keyboard; чужой deep link → «Сессия недоступна», stale buffer очищен, fake login отсутствует в production server.
- [ ] **5. Checkpoint:** интерфейс показывает доступные операции, но command side effects остаются disabled до task 11. Pair/revoke/logout работают через свой backend, не upstream shared state.

<a id="controls"></a>

## Task 11: Command dispatcher и одноразовые permissions — 2–3 часа

**Files:** Create `apps/daemon/src/commands/{dispatcher,store,permission-broker}.ts`, `apps/server/src/commands/{service,controller}.ts`, `apps/daemon/test/commands.test.ts`, `apps/daemon/test/permission-broker.test.ts`, `tests/integration/commands.test.ts`, `tests/e2e/controls.spec.ts`; Modify hook bridge/driver/gateways/UI controls.

**Interfaces:** `submitCommand(principal: Principal, command: ClientCommand): Promise<CommandResult>`, `dispatch(command: Command): Promise<CommandResult>`, `CommandStore.begin(command: Command): 'new' | CommandResult`, `finish(result: CommandResult): void`; PermissionBroker из общего контракта. POST `/commands`, GET `/commands/:id` owner-scoped; WS command frames используют тот же service, не отдельную policy.

- [ ] **1. Test:** `foreign_command_never_reaches_adapter`, `duplicate_id_dispatches_once`, `crash_after_send_is_unknown`, `permission_is_one_live_invocation`: B→A NOT_FOUND/send spy=0; same id twice send spy=1; stale generation/unsupported capability rejected; old requestId/new generation не resolves. Повтор commandId с другим payload запрещён.

```ts
await dispatch(validCommand);
await dispatch(validCommand);
expect(adapter.sendPrompt).toHaveBeenCalledTimes(1);
expect(broker.resolve(oldRequestId, newGeneration, 'allow')).toBe(false);
```

- [ ] **2. RED:** `pnpm exec vitest run apps/daemon/test/commands.test.ts apps/daemon/test/permission-broker.test.ts tests/integration/commands.test.ts`; `pnpm test:e2e -- tests/e2e/controls.spec.ts` → FAIL.
- [ ] **3. Implement:** relay stamps TTL 15s and checks owner/session/capabilities; companion повторно проверяет binding/capabilities/expiry и сериализует per-session. Persist-before-side-effect в SQLite, unknown после unfinished dispatch при restart. Adapt только hookSpecificOutput allow/deny из CCGram; local authenticated socket, 45s wait/60s hook timeout, no Telegram token/polling/Always/updatedPermissions. Transport timeout→local permission flow, late reply rejected. REMOTE_INPUT_ENABLED/REMOTE_PERMISSIONS_ENABLED default false, enable verified capabilities only.
- [ ] **4. GREEN:** все указанные tests, fake clocks и реальные disposable sessions: prompt/interrupt выбранного source, один permission allow/deny, local ответ раньше remote, disconnect, Mac sleep и повтор ack не дают чужого или повторного ввода. dispatched не отображать как «Claude успешно выполнил».
- [ ] **5. Checkpoint:** доказанные controls включены per source; Desktop Chat read+prompt принят отдельно. Недоказанный control не включать ради одинакового UI.

## Task 12: Приёмка, упаковка и запуск пилота — 4–5 часов

**Files:** Create `tests/integration/isolation.test.ts`, `tests/e2e/multi-user.spec.ts`, `scripts/load-relay.ts`, `scripts/package-daemon.ts`, `compose.yml`, `.env.example`, `docs/{acceptance,operations,install-daemon}.md`; Modify README, build/sign scripts.

**Interfaces:** produces `acceptance.md` с versions/results/actual time, versioned companion archive + SHA-256 и signed helper; один relay instance с persistent PostgreSQL, health endpoint без user data. Новых remote shell/admin APIs не добавлять.

- [ ] **1. Test:** `two_owners_cannot_cross_any_resource`: настоящие test DB/gateways + две identity проходят snapshot/history/replay/subscribe/command/permission/notification negative matrix. Добавить revoke during pending command, DB unavailable, relay/daemon restart, cache after logout.

```ts
expect((await clientB.get(`/sessions/${sessionA.id}/events`)).status).toBe(404);
expect((await clientB.post('/commands', commandForA)).status).toBe(404);
expect(adapterA.sendPrompt).not.toHaveBeenCalled();
```

- [ ] **2. RED/verify:** `pnpm exec vitest run tests/integration/isolation.test.ts`; `pnpm test:e2e -- tests/e2e/multi-user.spec.ts`. Если уже PASS — не ломать код ради искусственного RED; найденные дефекты воспроизвести regression test до исправления.
- [ ] **3. Implement/fix:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, Swift tests должны пройти. 30-min load: 20 owners × 1 device × 10 sessions, selected snapshot/user/second, 200 structured events/second, p95 event delivery ≤2s на записанной VM, bounded queues/memory. Проверить PostgreSQL backup/restore/retention, оба mobile clients и реальные Chat/Code/CLI/cmux с отсутствующим cmux на отдельном setup. Это часть бюджета, не работа «потом».
- [ ] **4. Package/operate:** fixed versions/lockfile, bundle companion с native dependencies, signed AX helper, checksum; Node.js 22+ external prerequisite. Clean-profile install проверяет pair/start/hooks install/uninstall и local consent. TLS/WSS + DATABASE_URL/BOT_TOKEN/PUBLIC_ORIGIN только env; один bot poller. Document revoke/logout, disabling controls, rollback only own hooks, update/re-pair и logs без payload.
- [ ] **5. Acceptance:** записать реальные PASS/FAIL/needs_setup и открытые blockers. Полный заявленный объём не считается готовым при нерешённом Desktop Chat. Публичное развёртывание/реальные credentials не выполняются в рамках запроса на план; при исполнении использовать выбранную пользователем инфраструктуру. Коммитов нет.

## Бюджет и порядок

| Группа                 | Tasks                              | Активные часы с AI |
| ---------------------- | ---------------------------------- | ------------------ |
| Upstream validation    | 0                                  | 2–4                |
| Платформа              | 1–3                                | 6–10               |
| Адаптеры               | 4–7                                | 8–13               |
| Наблюдение/UI          | 8–10                               | 6–9                |
| Управление/приёмка     | 11–12                              | 6–8                |
| Общий резерв, один раз | Исправления/интеграционные дефекты | 4–8                |
| **Всего**              | **13 tasks + резерв**              | **32–52**          |

Порядок последовательный: 0 → 1 (ранний Desktop gate) → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Native CLI/Desktop не ждут cmux, но полный пилот ждёт принятия всех заявленных источников. Оценка не предполагает параллельных субагентов.

Первый upstream demo: 4–8 часов суммарно с начала; собственный multi-user vertical slice появляется после auth/pairing/adapters/relay/UI и не обещается в тот же бюджет. Смена транспорта после отрицательного AX probe требует отдельной оценки. Уточнить бюджет по фактическим первым 2–4 часам.

## Self-review

Проверить до передачи исполнителю: каждое требование spec покрыто task; сигнатуры/пути едины; source license/pin/attribution указаны; пять Review Focus имеют конкретные тесты; smoke milestone не выдан за весь продукт; сумма 26–40 + 2–4 + 4–8 = 32–52 часа. Не считать предписанные PASS уже полученными — пока написан только план.

## Handoff

Прочитать этот план и две spec, затем исполнять tasks по одной через `superpowers:executing-plans`. При каждом checkpoint фиксировать фактическое время и результат тестов. Субагентный метод возможен после выбора пользователем; не спавнить их автоматически из этого документа. Первый шаг исполнения — task 0, pinned MIT imports и воспроизводимый smoke.
