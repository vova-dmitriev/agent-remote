# Claude Source Integrations Implementation Plan

> **Справочная версия.** Исполнять [основной план имплементации](2026-10-16-claude-remote-implementation.md). Чеклисты этого файла не выполняются дополнительно: задачи перенесены и согласованы там.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Рекомендуется последовательный executing-plans.

**Goal:** Подключать Desktop Chat, Desktop Code и обычный CLI наряду с cmux, сохраняя owner isolation и исходный контекст сессии.

**Architecture:** Общий companion маршрутизирует вызовы через SessionAdapter. Hooks/JSONL наблюдают Code; PTY даёт управляемый обычный терминал; подписанный Swift helper взаимодействует с явно выбранным Desktop chat через Accessibility. cmux bridge остаётся дополнительным адаптером.

**Tech Stack:** Node.js 22+, TypeScript strict, pnpm, Zod, node-pty, Swift/AXUIElement, Vitest. Сервисная платформа — NestJS/PostgreSQL/WSS из плана 01.

**Spec:** [Источники Claude](../specs/2026-10-16-claude-connectors-design.md) и [общая спецификация](../specs/2026-10-16-telegram-cmux-design.md).

**Prerequisites:** План 01 завершён, включая probe всех источников и multi-source Target schemas. Этот план выполняется **до плана 02 monitoring**. Код приложения ещё не написан.

**База оценки:** один разработчик с AI, адаптация проверенных upstream-модулей, включая целевые тесты. Часы активной работы; общий резерв и внешние ожидания учитываются отдельно в [бюджете](../../delivery-estimate.md).

## Global Constraints

- macOS first; один Mac/user и до 10 sessions/device; несколько изолированных пользователей. cmux не является runtime prerequisite для CLI/Desktop.
- Контракты Target/CapabilitySet/SessionAdapter из spec обязательны; kind + connectorId + deviceId + generation проверяются до любого side effect. Disabled capability → AdapterError(CAPABILITY_UNAVAILABLE), затем rejected CommandResult; никакого active-window/active-surface fallback.
- Remote API не выбирает executable, shell, AX selector, PID или координаты. CLI wrapper запускает только явно выбранный локально Claude; существующие чужие процессы не захватываются.
- Desktop UI требует локального Accessibility consent, выбранного чата и unlocked Mac. Не использовать private APIs, cookies, OAuth tokens и development channel bypass для штатного подключения.
- Command TTL 15 секунд, dedup 24 часа, prompt ≤16 KiB UTF-8, permission wait 45 секунд/hook timeout 60 секунд. Неизвестный результат отправки не повторяется автоматически. Коммиты запрещены.

## Review Focus

1. Claude Desktop Chat и Code имеют одинаковый заголовок — адресуются по разным binding, не по title.
2. Обычный `claude` уже работает без wrapper — UI не обещает доступ к его idle stdin.
3. CLI child завершился, Desktop сменил chat/account или появился локальный draft — remote send запрещён.
4. Нет cmux или Accessibility permission — остальные источники работают, неподдерживаемый control объяснён.
5. Отзыв устройства/смена generation и duplicate command не отправляют текст в соседний процесс/чат.

## Task 1: Общий слой адаптеров и capability routing

Оценка: 1–2 часа. Результат: backend/companion используют source identity без обязательных cmux UUID.

**Files — Create:** `apps/daemon/src/adapters/{session-adapter,registry,errors}.ts`, `apps/daemon/test/adapters/registry.test.ts`, `packages/protocol/test/targets.test.ts`.
**Modify:** `packages/protocol/src/{types,schemas,index}.ts`, `docs/compatibility.md`.

**Interfaces:** consumes Target/CapabilitySet из spec; produces SessionAdapter, ConnectorDescriptor, Binding, ProviderEvent, DispatchReceipt и AdapterRegistry с точными сигнатурами из spec. Объявления экспортируются, transport implementations их не меняют.

- [ ] **Step 1 — Написать failing routing/schema tests.** Fixtures используют четыре ветки Target и два разных connectorId одного kind.

```ts
expect(targetSchema.safeParse(cliTargetWithoutCmuxIds).success).toBe(true);
expect(targetSchema.safeParse(desktopChatTarget).success).toBe(true);
expect(targetSchema.safeParse({ ...cliTarget, surfaceId: 'focused' }).success).toBe(false);
expect(() => registry.resolve({ ...chatTarget, connectorId: otherConnector })).toThrow('NOT_FOUND');
await expect(disabledAdapter.sendPrompt(binding, 'test')).rejects.toThrow('CAPABILITY_UNAVAILABLE');
```

- [ ] **Step 2 — Запустить `pnpm exec vitest run packages/protocol/test/targets.test.ts apps/daemon/test/adapters/registry.test.ts`.** Ожидается FAIL на отсутствии registry/новых branches.
- [ ] **Step 3 — Реализовать registry и adapters contract.** Строгий discriminated union; cmux methods принимают только cmux branch. UI/relay не придумывает source-specific IDs. Adapter проверяет собственные capabilities до side effect; общий dispatcher плана 03 преобразует typed AdapterError в rejected CommandResult; degraded state имеет явный reason.
- [ ] **Step 4 — Прогнать те же tests и `pnpm typecheck`.** PASS; тесты fake adapters доказывают отсутствие cross-kind fallback и маршрутизацию без установленного cmux.
- [ ] **Step 5 — Проверить checkpoint.** Compatibility matrix различает discovered/verified/ready/unsupported и конкретные версии. Code/Desktop/Chat не объявляются равноценными по возможностям. Коммит не создавать.

## Task 2: Обычный CLI — hooks и управляемый PTY

Оценка: 2–3 часа. Результат: обычный `claude` наблюдается после hooks setup; `remote claude` получает prompt/interrupt в том же локальном терминале без cmux.

**Files — Create:** `apps/daemon/src/adapters/cli/{native-hooks,pty-wrapper,pty-session,cli}.ts`, `apps/daemon/test/adapters/cli/{native-hooks,pty-session}.test.ts`, `tests/integration/pty-claude.test.ts`, `docs/connect-terminal.md`.
**Modify:** daemon package scripts/bin entry, adapter registry, hook bridge contract; фактическое подключение общего monitor произойдёт в плане 02.

**Interfaces:** produces `NativeCliAdapter implements SessionAdapter`, `PtyCliAdapter implements SessionAdapter`; local `startClaude(argv: string[], terminal: LocalTerminal): Promise<PtyHandle>`, `LocalTerminal = {stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream}`, `PtyHandle = {sessionId: string; closeRemoteBinding(): void}`. Project CLI: `remote claude [--resume <session-id>]`; remote API не вызывает startClaude. Бинарное имя `remote` — предлагаемое локальное имя проекта, не команда Anthropic.

- [ ] **Step 1 — Написать failing tests с fake child и локальным authenticated IPC.** Проверить input/output/resize, сохранение cwd/env, child exit, companion disconnect, Unicode и duplicate command. Не использовать shell для создания тестовой child program.

```ts
expect(nativeCli.descriptor().capabilities.prompt).toBe(false);
expect(ptyCli.descriptor().capabilities.prompt).toBe(true);
expect(await sendAfterChildExit(command)).toMatchObject({ code: 'STALE_SESSION' });
expect(remoteInputDeliveredToShell).toBe(false);
expect(resumedClaudeArgs).toEqual(['--resume', sessionId]);
```

- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/daemon/test/adapters/cli tests/integration/pty-claude.test.ts`.** Ожидается FAIL на отсутствующем wrapper/binding lifecycle.
- [ ] **Step 3 — Реализовать hooks-only и PTY adapters.** Native mode не пишет в чужой TTY. PTY mode запускает фиксированный Claude executable через node-pty, сохраняет работу локального терминала и выдаёт companion собственный authenticated binding. Не принимать executable/произвольный shell command из Telegram. При companion crash локальная работа продолжается; child exit немедленно отключает remote input. Resume — явное действие локального пользователя после окончания прежнего frontend, не скрытая миграция процесса.
- [ ] **Step 4 — Прогнать tests/typecheck и ручной probe на Terminal.app/iTerm2.** Два независимых CLI, одинаковый cwd, разные session ID; полный control в managed mode, честный restricted state в native mode. Проверить Ctrl-C/resize, multiline prompt и permission timeout. Channels остаются необязательным исследовательским transport; custom plugin allowlist не обходится.
- [ ] **Step 5 — Проверить checkpoint.** В `docs/connect-terminal.md` две понятные инструкции: «обычный запуск/наблюдение» и «полное управление/PTY». Отсутствие cmux проверено; wrapper не назван бесшовным attach к уже запущенному PID. Коммит не создавать.

## Task 3: Desktop Chat и Code через локальный AX helper

Оценка: 4–7 часов при положительном probe. Результат: явно выбранные существующие Chat/Code sessions наблюдаются и принимают промпты в рамках проверенного AX transport.

**Files — Create:** `apps/macos-helper/Package.swift`, `apps/macos-helper/Sources/ClaudeBridge/{Main,Bindings,AccessibilityClient,ClaudeChat,ClaudeCode,Protocol}.swift`, `apps/macos-helper/Tests/ClaudeBridgeTests/{BindingTests,DraftTests,RoutingTests}.swift`, `apps/daemon/src/adapters/desktop/{bridge-client,chat-adapter,code-adapter}.ts`, `apps/daemon/test/adapters/desktop/{bridge-client,chat-adapter,code-adapter}.test.ts`, `scripts/build-macos-helper.ts`, `docs/connect-desktop.md`.
**Modify:** daemon registry/config и packaging scripts, protocol local IPC types. Swift target/compiler floor фиксируются по установленному Xcode после probe.

**Interfaces:** `DesktopChatAdapter`/`DesktopCodeAdapter implements SessionAdapter`. Narrow local JSON IPC: `bind`, `read`, `send_prompt`, `interrupt`, `unbind` с opaque bindingId/generation; arbitrary click/selector RPC запрещён. Swift helper хранит AX references локально; не отправляет их на relay. `bind(mode: 'chat' | 'code'): Promise<Binding>` запускается только из локального мастера.

- [ ] **Step 1 — Написать failing binding/draft tests и сформировать реальный probe.** AX snapshots для разных Claude versions обезличены; UI tests требуют установленный Claude и локальный consent, mock не заменяет probe.

```ts
expect(await sendToChangedChat(command)).toMatchObject({ code: 'STALE_SESSION' });
expect(await sendOverLocalDraft(command)).toMatchObject({ code: 'LOCAL_DRAFT_PRESENT' });
expect(chatAdapter.descriptor().capabilities.permission).toBe(false);
expect(chatAdapter.descriptor().capabilities.terminalSnapshot).toBe(false);
expect(await sendWithoutAccessibility(command)).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
```

Swift tests проверяют два одинаковых title, отличающиеся window/chat binding, повтор AX references после navigation, app/account restart, local draft, multiwindow. Chat status не превращается в фиктивный Code Stop/tool event.

- [ ] **Step 2 — Запустить `swift test --package-path apps/macos-helper` и `pnpm exec vitest run apps/daemon/test/adapters/desktop`.** Ожидается FAIL на отсутствующем helper/adapters. В isolated test Chat/Code проверить реальный AX read/composer/send/Stop и стабильный признак выбранной сессии. Если есть только title/focus и надёжная привязка невозможна, зафиксировать blocker и пересмотреть transport до продолжения.
- [ ] **Step 3 — Реализовать подписанный native helper и adapters.** Только Claude app и выбранный chat; операция прекращается при изменении binding/account/generation, missing permission, lock screen или непустом локальном composer. Не использовать глобальное typing/paste, private app endpoints/cookies/CDP. Chat выдаёт доступные UI messages и inferred status; Code дополнительно использует hooks и доказанное сопоставление session ID. Ошибка после возможного send возвращает unknown без повторного нажатия.
- [ ] **Step 4 — Прогнать Swift/TS tests и реальные Desktop scenarios.** Chat→Code→Chat, два одинаковых title, два окна, lock/unlock, local draft, локальный ввод одновременно с удалённым, Claude update, Mac sleep и device revoke. Отправка в неправильный chat — блокирующий дефект. Работа foreground/unlocked явно проверяется; background/headless не обещается.
- [ ] **Step 5 — Проверить checkpoint и упаковку.** Build/sign helper, проверить подпись и checksum, установить на чистом macOS user profile, пройти Accessibility consent и source selection. `docs/connect-desktop.md` описывает Chat и Code отдельно, ограничения visible history/permissions и снятие доступа. Desktop Chat support считается готовым только после подтверждённых read + prompt именно в исходном выбранном чате. Коммит не создавать.

## Task 4: Подключение источников и устойчивость общего companion

Оценка: 1 час. Результат: одна привязка Mac, несколько source connectors, понятные setup states; cmux optional.

**Files — Create:** `apps/daemon/src/{connector-service,setup-cli}.ts`, `apps/daemon/test/connector-service.test.ts`, `tests/integration/connectors.test.ts`, `docs/source-capabilities.md`.
**Modify:** helper/wrapper/registry lifecycle; последующие UI задачи плана 02 потребляют этот API.

**Interfaces:** `listConnectors(): ConnectorDescriptor[]`, `connectSource(kind: ProviderKind): Promise<ConnectorDescriptor>`, `disconnectSource(connectorId: string): Promise<void>` — локальная настройка. Relay `GET /devices/:id/connectors` возвращает только descriptors владельца; connectSource с системными разрешениями не запускается удалённо.

- [ ] **Step 1 — Написать failing acceptance tests.** Device A имеет Chat/Code/CLI, device B — cmux; одинаковые local titles и session IDs не смешивают ownership. Отключение cmux не затрагивает Desktop/CLI, disconnect одного connector не трогает остальные, revoke Mac отключает все remote bindings.
- [ ] **Step 2 — Запустить `pnpm exec vitest run apps/daemon/test/connector-service.test.ts tests/integration/connectors.test.ts`.** Ожидается FAIL до реализации lifecycle.
- [ ] **Step 3 — Реализовать source registration/status/diagnostics.** Missing cmux — состояние одного optional adapter, не fatal error companion. Installer не включает allowAll. Общий companion запускается отдельно; cmux bridge при необходимости отдельно из cmux. Hook installation сохраняет чужие hooks; AX consent только локально.
- [ ] **Step 4 — Выполнить `pnpm test` и `pnpm typecheck`, проверить ручной setup на Mac без cmux.** PASS; Chat, Code и terminal описывают реальные capabilities. Не считать отсутствующий prompt capability полным выполнением исходного требования.
- [ ] **Step 5 — Проверить handoff.** `docs/source-capabilities.md` содержит фактическую матрицу version/OS/setup/read/prompt/interrupt/permission. Перейти к plan 02 monitoring; если Chat AX probe не прошёл, отметить невыполненное требование и согласовать новый подход на основании конкретной ошибки. Коммит не создавать.

## Handoff

Пользователь проверяет границы и ограничения этого плана вместе со spec. После реализации этого подпроекта план 02 подключает adapters к единому monitor/relay/UI; план 03 добавляет production command routing и общую приёмку. Бюджет этого подпроекта 8–13 часов, включая 4–7 часов на Desktop при положительном probe; общий резерв не включён. При провале probe нужно пересмотреть транспорт, а не объявлять Chat готовым.
