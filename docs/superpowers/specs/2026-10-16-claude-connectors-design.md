# Источники Claude — Desktop Chat, Desktop Code, CLI и cmux

Статус: дополнение к [общей спецификации](2026-10-16-telegram-cmux-design.md); план, а не проверенная реализация.
Пользователь явно подтвердил оба режима Desktop: Chat и Code. Несколько пользователей и изоляция аккаунтов сохраняются.

## Цель подключения

Один локальный companion на Mac, одна привязка к Telegram-аккаунту, затем выбор источника. Установка cmux не требуется. Пользователь сохраняет исходное приложение, историю и контекст; интеграция не заменяет существующую сессию новым вызовом Anthropic API.

Первый supported OS — macOS. «Обычный терминал» означает Terminal.app, iTerm2 и другой терминал с CLI Claude Code на этом Mac; Windows/Linux не объявляются готовыми без отдельной проверки.

## Проверенные основания и пределы выводов

[Claude Code Desktop](https://code.claude.com/docs/en/desktop) использует hooks/settings также в Code sessions. [Remote Control](https://code.claude.com/docs/en/remote-control) продолжает CLI/Desktop Code через клиенты Claude. Это не документированный API для подключения произвольного Telegram frontend: не извлекать приватные OAuth tokens и не воспроизводить внутренний протокол.

[Channels](https://code.claude.com/docs/en/channels) допускают двусторонние события и permission relay, но находятся в research preview; собственный канал зависит от allowlist и session opt-in. Не обещать общедоступный custom channel и не требовать development bypass flag как штатную установку сервиса. Не использовать общий сервисный bot token одновременно для polling в каждом пользовательском Claude: polling и routing остаются на relay.

[Desktop MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) даёт приложению инструменты MCP server. Из этого не следует право сервера читать все чаты или вводить новые сообщения в простаивающий Chat. В просмотренных официальных материалах публичный attach API обычных Desktop Chat не найден; это ограничение исследования, не доказательство отсутствия любого возможного API.

Предлагаемый путь для Desktop Chat — локальный native helper на [macOS Accessibility API](https://developer.apple.com/documentation/applicationservices/axuielement). Наличие нужных элементов в AX tree конкретной версии Claude ещё не проверено. При невозможности надёжной привязки и отправки этот блок требует пересмотра; MCP-коннектор нельзя выдать за выполненную поддержку управления Chat.

## Матрица поведения первого релиза

| Источник                             | Наблюдение                                                                    | Промпт в исходный контекст                                                                                   | Прерывание / разрешения                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| cmux + Claude Code                   | Hooks/JSONL и snapshot выбранного surface                                     | Targeted cmux input после проверки binding                                                                   | Escape; permission hook                                        |
| Обычный CLI, уже запущенный `claude` | Hooks/JSONL после подключения; установка hooks может требовать resume/restart | Hooks не дают stdin idle-процесса; read-only до подключения управляемого transport                           | Permission hook при доступности; без произвольного TTY input   |
| CLI через `remote claude`            | Те же hooks/JSONL; локальный terminal продолжает работать                     | Companion-owned PTY; `remote claude --resume <session-id>` сохраняет контекст при явном переходе             | Проверенный Escape/interrupt и permission hook                 |
| Claude Desktop, вкладка Code         | Hooks/JSONL + локальная привязка Code session к UI                            | AX composer выбранной Code session после probe; native Remote Control — отдельная внешняя ссылка, не наш API | Доказанная UI Stop capability; permission hook                 |
| Claude Desktop, обычный Chat         | Только явно выбранный чат и доступные UI сообщения                            | AX composer/send выбранного чата после probe                                                                 | Stop button при доступности; Code tool permissions отсутствуют |

Матрица — целевое поведение, а не заявление, что AX/PTY уже проверены. Channels могут заменить terminal input при разрешённой конфигурации, но не являются обязательным условием первого релиза.

## Общая модель адаптера

Target union и CapabilitySet определены в общей спецификации. Внутренние контракты:

```ts
type ProviderKind = Target['kind'];
type ConnectorDescriptor = {
  connectorId: string;
  kind: ProviderKind;
  transport: 'cmux' | 'hooks' | 'pty' | 'accessibility' | 'channel';
  sourceVersion: string;
  capabilities: CapabilitySet;
  state: 'ready' | 'needs_setup' | 'needs_restart' | 'unsupported' | 'disconnected';
  reason: string | null;
};
type Binding = { target: Target; generation: string; localProof: string };
type ProviderEvent = {
  sessionId: string;
  type: 'message' | 'status' | 'tool' | 'snapshot' | 'permission' | 'binding_lost';
  occurredAt: number;
  payload: unknown;
};
type DispatchReceipt = { status: 'dispatched' | 'unknown'; code?: string };
interface SessionAdapter {
  descriptor(): ConnectorDescriptor;
  discover(): Promise<Binding[]>;
  observe(binding: Binding): AsyncIterable<ProviderEvent>;
  sendPrompt(binding: Binding, text: string): Promise<DispatchReceipt>;
  interrupt(binding: Binding): Promise<DispatchReceipt>;
  close(): Promise<void>;
}
```

Disabled методы выбрасывают `AdapterError` с code `CAPABILITY_UNAVAILABLE` до побочного эффекта; общий dispatcher переводит ошибку в rejected CommandResult. `PermissionBroker` остаётся отдельным одноразовым transport; adapter descriptor не создаёт разрешение сам по себе. `localProof` хранится только на Mac. Relay принимает только непривилегированные target IDs; повторная локальная проверка обязательна. Protocol version остаётся 1, поскольку до этого были только документы и ничего не выпускалось.

`AdapterRegistry.register(adapter: SessionAdapter): void`, `resolve(target: Target): SessionAdapter`, `list(): ConnectorDescriptor[]`. Resolve проверяет kind + connectorId + deviceId; совпадение session title/cwd недостаточно. Нет fallback на active terminal или current chat. Session identity включает источник/connector и generation; одна Code session, видимая в hooks и UI, объединяется только после проверенного сопоставления session ID.

## Обычный терминал

Первый путь: одна установка hooks → пользователь запускает `claude` как привык → companion показывает события и доступные permissions. Если idle prompt transport отсутствует, UI объясняет это явно.

Полный control path: пользователь запускает `remote claude` в обычном терминале. Wrapper создаёт PTY только для фиксированного executable Claude, передаёт stdin/stdout/resize и Ctrl-C локального пользователя, не меняет его cwd/env и не открывает shell command endpoint. Допустимые аргументы к CLI задаются явным parser; remote API не может выбирать executable или запускать новый процесс. Локальный wrapper регистрирует одноразовый authenticated binding к companion; завершение child немедленно инвалидирует generation. PtyHandle.sessionId определяется по SessionStart; пока binding не получен, remote controls выключены, локальный terminal работает. Не угадывать session ID по имени проекта.

Уже запущенный внешний CLI нельзя объявлять захваченным: предлагается явный локальный resume в wrapper с тем же session-id, после завершения прежнего frontend, без одновременного resume в два процесса. Новый процесс не выдаётся за тот же PID. При падении companion wrapper сохраняет локальный ввод/вывод и удаляет remote binding; при смерти child удалённый ввод не попадает в shell.

## Desktop Code и Chat

Локальный мастер подключения предлагает отдельные пункты Code и Chat, проверяет установленную версию Claude и Accessibility permission. Пользователь сам даёт macOS разрешение helper и выбирает конкретную сессию/чат. На relay отправляется opaque binding ID; arbitrary AX selectors, координаты, PID и bundle ID через remote API запрещены.

Swift helper ограничен Claude app и операциями `bind`, `read`, `send_prompt`, `interrupt`, `unbind`. Нельзя использовать глобальное «вставить в активное окно». Сначала probe устанавливает доступность AX text/composer/send/Stop и стабильного признака чата. Если доступен только заголовок или текущий focus, такой binding не считается verified. При навигации в другой чат, закрытии окна, app restart или смене account все связанные generations инвалидируются. Разрешён только выбранный локально чат; сканирование всей истории аккаунта не производится.

Для первого релиза Desktop UI transport требует unlocked Mac и доступного окна Claude. Работа при lock screen, скрытых/выгруженных chats и headless не обещается. Удалённая отправка не крадёт focus и не переписывает локальный draft: непустой composer → `LOCAL_DRAFT_PRESENT`, изменённый binding → `STALE_SESSION`. Неопределённый результат отправки → unknown без автоповтора. AX operations не дают атомарной гарантии против любого локального вмешательства: supported boundary и обнаруженные гонки записываются в compatibility report; небезопасный send остаётся disabled.

Chat отдаёт только видимые/доступные текстовые сообщения; это неполная история. Наблюдаемые UI статусы имеют метку `inferred`; они не создают «успешное завершение задачи», file/tool events или permission capabilities. Attachments, голос, выбор модели, удаление/создание чатов и Chat/Cowork tool approvals вне этой версии. Для Code hooks дают более точные события, но привязку hook session к Code UI нужно доказать отдельно.

UI helper поставляется подписанным macOS app/helper; `swift build`/codesign/checksum и установка на чистом profile входят в план. Screen Recording, OCR, private Electron debugging endpoints, перехват cookies/session tokens не используются как скрытый fallback. Если AX недостаточно, вопрос о другом способе подключения возвращается пользователю с конкретным результатом probe.

## Приёмка и критерий остановки

Управление каждого источника принимается отдельно. Наличие процесса/установленного приложения не включает controls. Отключение cmux или отсутствие его на машине не мешает CLI/Desktop sources. Отзыв device token отключает все source bindings этого Mac без вмешательства в локальную работу Claude.

Обязательны тесты: два пользователя и разные источники с одинаковым title; Chat/Code switching; duplicate command; reconnect; stale binding; missing Accessibility permission; local draft; CLI child exit и idle native CLI; отсутствие cmux; Desktop app update; lock/unlock; permission timeout. UI показывает причину ограничения и действие подключения.

Если Desktop Chat probe не подтверждает read + prompt в выбранный существующий чат, этот пункт исходного запроса остаётся нерешённым. Не отмечать общий релиз с Desktop Chat готовым; пересмотреть способ интеграции и оценку. Бюджет адаптеров с AI и reuse — 8–13 часов: общий слой 1–2 часа, CLI 2–3 часа, Desktop 4–7 часов при положительном probe, setup/lifecycle 1 час. Общий резерв указан отдельно в [оценке работ](../../delivery-estimate.md).
