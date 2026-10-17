# Telegram Remote — многопользовательский сервис для Claude Desktop и Claude Code

Статус: проект для проверки пользователем; реализация не начата.
Дата: 2026-10-16.

## Цель и исходные данные

С телефона видеть и продолжать работу Claude Desktop (Chat и Code) и Claude Code в обычном терминале либо cmux. Подтверждено пользователем: поддержать оба режима Desktop, обычный терминал и несколько пользователей. cmux — необязательная интеграция. Подключение сохраняет исходную сессию и её контекст; доступные операции зависят от доказанных возможностей адаптера, которые интерфейс показывает явно.

Источник: [общая ссылка ChatGPT](https://chatgpt.com/s/t_6ad21a3230b481918705aa0b4d7c9b1d). По ссылке доступен один ответ ассистента, а не вся предшествующая переписка. Он описывает React Mini App, NestJS backend и Node.js daemon; cmux отвечает за терминал, hooks и JSONL — за события и историю. Это исходная идея, а не уже согласованная спецификация.

Подтверждено пользователем: нужен сервис для нескольких пользователей. Каждый пользователь видит и контролирует только свои Mac и сессии.

Допущение для первого релиза: один личный аккаунт на Telegram ID, один Mac на аккаунт, до 10 одновременно наблюдаемых сессий на Mac; без командных пространств и совместного доступа. Схема допускает несколько устройств, но продуктовая квота первого релиза — одно. Начальная нагрузочная цель — 20 одновременно подключённых пользователей; это предлагаемый размер пилота, не подтверждённое требование.

Репозиторий проекта создан отдельно: `/absolute/path/claude-remote`. Хостинг, домен и bot username пока не выбраны.

Успех: пользователь самостоятельно входит через Telegram и привязывает Mac; два аккаунта не могут прочитать или изменить данные друг друга, в том числе через WebSocket, deep link и угаданный UUID. Две сессии одного Mac различимы с телефона; после разрыва связи UI восстанавливается; просроченный ответ на разрешение не применяется к новому запросу.

Подробная матрица источников, подключение и ограничения: [спецификация интеграций](2026-10-16-claude-connectors-design.md). Её общие контракты применяются ко всем источникам; cmux-специфичные пункты ниже относятся только к cmux адаптеру.

## Проверенные факты и ограничения

Локально доступен `/Applications/cmux.app/Contents/Resources/bin/cmux`, версия `0.65.1 (110) [8a853dcc9]`. Проверены только `version` и справка. Содержимое терминалов не читалось, ввод не отправлялся. В справке есть `read-screen`, `send`, `send-key` с явными workspace/surface/window и `--id-format uuids`.

[cmux API](https://cmux.com/docs/api) описывает newline-delimited JSON RPC, адресацию surfaces и режим `cmux processes only`. Установленная CLI сообщает другой путь сокета по умолчанию, чем веб-документация. Поэтому путь определяет конфигурация/диагностика установленной версии; `/tmp/cmux.sock` нельзя зашивать в приложение. Доступ из независимого launchd-процесса не считать доказанным.

[Claude Code hooks](https://code.claude.com/docs/en/hooks) дают `session_id`, `transcript_path` и события жизненного цикла. `Stop` обозначает окончание хода, а не успешное завершение всей задачи. `PermissionRequest` поддерживает решение через hook и не содержит `tool_use_id`: интеграция создаёт собственный идентификатор запроса. Полноту покрытия всех диалогов обещать нельзя. Доступность конкретных событий и формат JSONL проверяются на установленной версии.

[Telegram Mini Apps](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) требует серверной проверки `initData`. Telegram-идентичность берётся только из проверенных данных.

Исполняемая детализация: [основной implementation plan](../plans/2026-10-16-claude-remote-implementation.md). Он фиксирует выборочный MIT reuse из cc-tg-hub/CCGram/cmux-tui и конкретные задачи. Предыдущие четыре подробных плана сохранены как справочные и не добавляют второй набор работ.

## Выбор архитектуры

| Вариант                                                      | Затраты и ограничения                                              | Решение                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------ |
| Отдельный сервер на Mac каждого пользователя + HTTPS-туннель | Сложная настройка, отдельный публичный адрес на пользователя       | Не подходит для общего сервиса |
| React + общий NestJS relay + daemon на каждом Mac            | Централизованный вход и ownership; Mac устанавливает исходящий WSS | Рекомендуется для MVP          |
| Новый менеджер процессов через Agent SDK                     | Меняет привычный запуск и владение процессами                      | За рамками задачи              |

Поток: `Telegram Mini App → HTTPS/WSS → NestJS relay ← исходящий WSS ← local companion → адаптеры Claude Desktop Chat / Desktop Code / CLI / cmux`.
Claude Code hooks подключаются к companion по отдельному локальному Unix socket; JSONL читается локально. Для Desktop Chat используется отдельный macOS Accessibility helper после локального разрешения и привязки выбранного чата; возможность проверяется на реальной версии приложения. Бот отправляет уведомления из relay. Внешний сервер не получает доступ к cmux socket.

Стек как проектное предложение: Node.js 22+, TypeScript strict, pnpm workspaces; React + Vite; NestJS + ws; Zod для протокола; node-pty для opt-in CLI wrapper, Swift/AXUIElement для Desktop helper; PostgreSQL на relay (`pg` + SQL migrations), SQLite/better-sqlite3 на daemon; Vitest и Playwright. При реализации фиксировать совместимые версии в lockfile. Первый запуск — один экземпляр relay с ограниченными очередями, без Redis/Kubernetes; горизонтальное масштабирование требует общего маршрутизатора device connections и не входит в пилот.

## Границы первого релиза

Включено:

1. Вход через Telegram, привязка/отзыв своего Mac и выбранных сессий: Desktop Chat, Desktop Code, CLI или cmux.
2. Лента доступных сообщений/событий; терминальный снимок только для адаптеров с этой возможностью, отдельная метка источника.
3. Промпты и прерывание через доступный адаптер; одноразовое allow/deny только для доказанного Claude Code permission transport. Desktop Chat не получает фиктивные tool hooks.
4. Уведомления «ход завершён», «нужно внимание», «Mac недоступен» с переходом в нужную сессию.
5. Восстановление после reconnect, ограниченный буфер событий, журнал команд без текста промптов.

Вне релиза: команды/организации, общий доступ к Mac, несколько Mac в интерфейсе одного пользователя, биллинг, произвольный запуск/завершение чужих процессов, kill по PID, создание терминалов, произвольный shell endpoint, автоматическое одобрение, постоянные permission rules, редактор файлов, полный xterm, гарантированный поток токенов. Произвольные меню и `AskUserQuestion` показываются в снимке; специализированный удалённый ответ требует отдельного проверенного адаптера и не входит в этот релиз.

## Модель и протокол

Все перечисленные интерфейсы — новые проектные решения; существующего кода приложения здесь нет.

Серверная модель: `User {id, telegramId UNIQUE, createdAt}`, `Device {id, ownerId, tokenHash, revokedAt, generation}`, `AuthSession {tokenHash, ownerId, expiresAt}`, `Session`, `Event`, `CommandAudit`, `Notification`, `Pairing`. Telegram ID хранить как bigint/string. У каждой записи с пользовательскими данными есть ownerId; составные FK `(ownerId, deviceId)` предотвращают перепривязку сессии/события к чужому устройству. CLI/daemon не выбирает ownerId: relay выводит его из device token. Browser API выводит ownerId из auth session; поля ownerId/accountId из клиента запрещены.

Ownership неизменяемый: перенос устройства другому пользователю — revoke и новая локальная привязка. Существующий device token не может сменить owner. Во внутренних серверных интерфейсах `ownerId` равен `Principal.userId`. Все чтения, подписки, replay, history, snapshots, команды и notification queries фильтруются по ownerId. Чужой и неизвестный resource дают одинаковый `NOT_FOUND`. Даже при одинаковых cmux UUID на разных Mac sessions различаются через deviceId.

`Target` — discriminated union (все идентификаторы, кроме явно локальных, — непрозрачные строки):

```ts
type Target =
  | {
      kind: 'cmux';
      deviceId: string;
      connectorId: string;
      windowId: string;
      workspaceId: string;
      surfaceId: string;
    }
  | { kind: 'claude-code-cli'; deviceId: string; connectorId: string; claudeSessionId: string }
  | { kind: 'claude-code-desktop'; deviceId: string; connectorId: string; claudeSessionId: string }
  | { kind: 'claude-desktop-chat'; deviceId: string; connectorId: string; chatBindingId: string };
```

UUID cmux обязательны только в ветке cmux; sentinel/focused/current и фиктивные UUID запрещены. `connectorId` и `chatBindingId` создаёт локальный companion при явном подключении, а не relay по заголовку окна.

`CapabilitySet = { observe: boolean; history: boolean; prompt: boolean; interrupt: boolean; permission: boolean; terminalSnapshot: boolean }`. `Session` дополнительно содержит `capabilities: CapabilitySet` и `integrationState: 'ready' | 'needs_setup' | 'needs_restart' | 'unsupported' | 'disconnected'`. Отсутствующая capability запрещает действие на сервере и локально, а не только скрывает кнопку.

`Session = { id: string; target: Target; claudeSessionId: string | null; generation: string; status: Status; binding: 'verified' | 'unverified'; lastEventAt: number; capabilities: CapabilitySet; integrationState: 'ready' | 'needs_setup' | 'needs_restart' | 'unsupported' | 'disconnected'; statusConfidence: 'observed' | 'inferred' }`.

`Status = 'unknown' | 'idle' | 'running' | 'waiting_permission' | 'waiting_input' | 'ended'`; состояние подключения устройства отдельно: `online | offline`. Ошибка инструмента — событие, не автоматически конец сессии.

`EventEnvelope = { version: 1; deviceId: string; streamId: string; seq: number; eventId: string; sessionId: string | null; occurredAt: number; type: string; payload: unknown }`.

`Command = { version: 1; commandId: string; target: Target; sessionId: string; generation: string; expiresAt: number; action: Action }`.

`Action = { type: 'prompt'; text: string } | { type: 'escape' } | { type: 'interrupt' } | { type: 'permission'; requestId: string; decision: 'allow' | 'deny' }`.

Relay назначает командный TTL 15 секунд от момента приёма; браузер не может продлить его. Для permission expiry дополнительно ограничен сроком живого request. Локальный command dedup хранится 24 часа; повтор commandId с другим payload отклоняется.

`CommandResult = { commandId: string; status: 'accepted' | 'dispatched' | 'rejected' | 'unknown'; code?: string }`. `dispatched` означает доставку в cmux/hook, а не успешное выполнение задачи Claude.

Лимит prompt 16 KiB UTF-8 и запрет NUL/ESC/CR/управляющих символов кроме LF/TAB применяются ко всем источникам, включая Desktop composer.

Снимок содержит также `terminal: {sessionId: string; generation: string; text: string; capturedAt: number} | null`. Подписка UI выбирает один sessionId, relay проверяет ownership и передаёт выбор daemon; снимки приходят как `terminal_snapshot` event и при resync. Переключение не меняет focus локального cmux.

`PendingPermission = { requestId: string; sessionId: string; generation: string; toolName: string; input: unknown; expiresAt: number }`.

Схемы строгие; неизвестные версии отклоняются. Неизвестные события Claude сохраняются как диагностический тип без необработанного содержимого. Запрет неограниченных `rpc`, shell и произвольных клавиш — часть серверного и локального протокола.

## Сбор и сопоставление данных

Общий companion работает без cmux. Только cmux bridge запускается внутри cmux terminal при режиме cmux processes only и подключается к companion через локальный аутентифицированный socket; привилегии cmux не расширяются. Для native CLI/Desktop hooks и AX helper этот bridge не требуется. Установка не включает `allowAll`. cmux/Claude settings изменяются только при реализации; существующие hooks нужно сохранить.

Список окон/workspaces/surfaces опрашивается каждые 5 секунд. Избранный surface читается не чаще одного раза в секунду, с максимумом 200 строк и 64 KiB на снимок. Невыбранные терминалы не читаются. Неизменный снимок повторно не передаётся. Только разрешённые локально surfaces становятся видны relay.

В cmux адаптере hook bridge связывает Claude `session_id` с унаследованными cmux IDs; `SessionStart` создаёт новую `generation`. Для уже работающей сессии без hook binding доступен снимок со статусом unknown; ввод выключен до подтверждённого сопоставления. Сопоставлять по одному cwd/заголовку нельзя: там могут идти несколько процессов. Установку hooks в уже запущенный Claude и момент их загрузки проверяет первый этап; при необходимости UI сообщает о локальном resume/restart.

Hooks поддерживаемого набора обновляют статус; JSONL даёт известные сообщения. `UserPromptSubmit` → running; `Stop` → idle и уведомление об окончании хода; `SessionEnd` → ended; `PermissionRequest` → waiting_permission. Обычный текст «?» в терминале не доказывает waiting_input. Состояния инвалидируются при смене generation, закрытии surface и потере проверяемой привязки.

JSONL reader применяется только к Code-источникам; Desktop Chat читает доступные UI сообщения. JSONL reader читает только путь, полученный от локального hook, после realpath-проверки принадлежности разрешённому каталогу Claude. Внешний API не принимает файловые пути. Чтение по byte offset, с буфером неполной UTF-8/JSONL строки, защитой от truncate/rotate и неизвестной схемы. Размер строки максимум 1 MiB. Сырые tool outputs, скрытые рассуждения и содержимое файлов автоматически в relay не выгружаются.

События хранятся локально до 24 часов либо 10 000 записей. `streamId` меняется при сбросе журнала; seq монотонен внутри stream. Relay использует уникальный `(deviceId, streamId, seq)`. При пропуске за пределами буфера — явный `resync_required` и новый snapshot, без обещания полной истории.

## Авторизация, соединение и хранение

`POST /auth/telegram` проверяет подпись, обязательного user, возраст `auth_date` не более 300 секунд и будущую дату не дальше 30 секунд; по проверенному telegramId создаёт/находит User и выдаёт случайный bearer сроком 15 минут. Username не определяет идентичность. Регистрация доступна пользователям бота; публичный произвольный Telegram ID не является авторизацией. Токен только в памяти Mini App; bot token только на сервере. Есть logout/revoke auth session. Повторное получение токена требует свежих допустимых initData или повторного открытия приложения.

Browser подключается к `/ws/app`, аутентифицируется первым frame в течение 5 секунд. Учитываются allowlist Origin, expiry и владелец на каждом действии; до auth нет подписок. Подключение закрывается при expiry. Bearer не передаётся в URL. TLS обязателен.

На Mac daemon генерирует 128-битный pairing code с TTL 5 минут и регистрирует его hash вместе с отдельным proof secret. Пользователь вводит code в своей авторизованной Mini App. Перед выдачей device token daemon показывает Telegram ID привязывающего пользователя и требует локального подтверждения. Claim выполняется транзакционно один раз и учитывает квоту аккаунта. Отменённый/истёкший claim не создаёт устройство. Code и proof secret не пишутся в логи и URL; получить итоговый device token может только daemon с proof secret. Это часть установки, не обёртка для запуска Claude.

Device token хранится на Mac в файле mode 0600, на relay — только hash; есть отзыв из Mini App с немедленным закрытием device socket и отменой pending requests. `/ws/device` отделён от browser auth. Старый token после revoke не подключается. Один активный connection epoch на устройство: новый валидный connection закрывает старый; старый socket не может отправлять события или получать команды после замены.

Heartbeat каждые 10 секунд, offline после 30 секунд без heartbeat; reconnect с jitter от 1 до 30 секунд. При offline команды отклоняются, а не копятся для исполнения после пробуждения Mac. UI показывает время последнего события. Reconnect начинается с snapshot и подтверждённого курсора; контроллеры ввода включаются после синхронизации.

Relay хранит пользователей, ownership, auth/pairing/device metadata, ограниченные события и audit в PostgreSQL; retention событий 24 часа/10 000 на device. Локальный dedup команд остаётся в SQLite daemon. Не хранить prompt body в CommandAudit: только owner/device/session/commandId/action/status/timestamp. В логах нет initData, bearer, pairing code, prompt, screen или tool input. Публикация терминалов означает передачу их видимого текста оператору сервиса; это указано до подключения. TLS не является end-to-end encryption, фильтр секретов не обещает полной защиты. Ретенция бэкапов с содержимым — максимум 7 дней, доступ только оператору, backup/restore проверяется до публичного запуска.

Квоты пилота: 1 active device на пользователя, 10 sessions/device; 30 commands/min/user, 10 auth/min/IP, 5 pairing attempts/min/IP и user; payload frame максимум 128 KiB, socket queue максимум 256 frames/1 MiB. Равномерное планирование по устройствам исключает блокировку остальных одним noisy client. Очереди и лимиты применяются до дорогостоящей обработки. Authenticated HTTP API не использует userId из request body; административного просмотра чужих терминалов в продукте нет.

## Ввод и подтверждения

Все команды проходят локальную проверку device, connectorId, discriminant kind, generation, binding, capability и expiry. Только cmux-команда дополнительно проверяет window/workspace/surface UUID. Нельзя перенаправлять команду в другой адаптер при отказе текущего. На одну сессию — последовательная очередь. Дедупликация по commandId сохраняется в локальном SQLite до отправки побочного эффекта; если daemon упал между отправкой и записью результата, возврат `unknown`, без автоматического повтора.

Для cmux/PTY адаптера промпт допускается для подтверждённой idle-сессии, максимум 16 KiB UTF-8. NUL, ESC, CR и управляющие символы кроме LF/TAB отклоняются. Многострочный текст вводится через проверенный bracketed-paste механизм установленной CLI, затем submit; поддержка проверяется в изолированной тестовой сессии. Не использовать shell interpolation. Это удалённый ввод в терминал: cmux не обеспечивает атомарную проверку «сейчас внутри Claude». При одновременном локальном вводе/выходе Claude остаётся гонка; если spike не даёт приемлемого способа обнаружения завершения/потери binding, prompt capability остаётся выключенной и этот риск возвращается на пересмотр архитектуры.

Для CLI без управляемого PTY hooks дают наблюдение и permission bridge, но не stdin простаивающего процесса; существующая сессия не объявляется полноуправляемой. Полное подключение обычного терминала выполняется через явный `remote claude` / `remote claude --resume <session-id>` в PTY, с возобновлением контекста, либо доказанный opt-in channel. Companion не перехватывает произвольный существующий TTY. Для Desktop Code и Chat — отдельная привязка UI и проверки, описанные в спецификации интеграций.

`interrupt` — семантическая операция адаптера: PTY/cmux отправляет проверенную клавишу, Desktop нажимает проверенную Stop button выбранного чата. Отсутствие такой возможности отключает операцию. Raw `escape` разрешён только в terminal adapters.

Escape — отдельное действие «Отправить Escape», только в проверенный target. Оно не обещает kill процесса или отмену любого инструмента. Произвольный Enter/Control-C и автоматические ответы по распознаванию текста не предоставляются.

Разрешение: синхронный command hook создаёт одноразовый requestId и ждёт до 45 секунд при настроенном hook timeout 60 секунд. Allow/deny относится к конкретному живому hook invocation, а не к экрану. Ответ не меняет `updatedPermissions` и не сохраняет правила. Timeout/disconnect возвращает управление обычному локальному permission flow без allow; поздний ответ отклоняется. Остальные hooks не ждут сеть; локальная недоступность мониторинга не должна блокировать работу Claude. Совместимость fallback и конкуренцию hooks обязательно проверить в spike.

## UI и уведомления

Два основных экрана: список сессий и выбранная сессия. На втором: источник Chat/Code/CLI/cmux, имя проекта, статус, свежесть и capability diagnostics; вкладки «События»/«Терминал» по доступности; composer, прерывание и карточка permission с инструментом, параметрами и обратным отсчётом. Unverified binding, offline, stale generation и истёкший токен отключают управление с понятной причиной. Текст терминала выводится как текст, HTML и escape-последовательности не исполняются.

Telegram theme/safe area и мобильная клавиатура учитываются. Пока человек читает историю, новые события не прокручивают экран принудительно. Следующий snapshot очищает отставание после resync.

Уведомления только в личный chat соответствующего пользователя после `/start`, без текста терминала и команд. Принимать Telegram updates через один polling worker; private chat сверяется с from.id и существующим User, group updates не создают notification destination. Создание аккаунта и `/start` допускаются в любом порядке через upsert telegramId. Dedup по ownerId/eventId/requestId, offline — один раз на переход. После reconnect события старше 60 секунд попадают в историю без старых уведомлений. Retry учитывает Telegram 429/retry_after, глобальный и per-chat limiter; возможен повтор при неопределённом ответе API, exactly-once не обещается. Заблокированный бот отключает уведомления только для этого пользователя. Deep link содержит непривилегированный session id; доступ проверяет ownership. Ответить на permission из notification без открытия приложения нельзя.

## Проверка и выпуск

Четыре зависимых подпроекта с отдельными планами: платформа пользователей/устройств; адаптеры источников; наблюдение; управление. Общая последовательность: compatibility probe всех источников → identity/ownership/pairing → адаптеры → daemon/events → relay/UI/notifications → controls → приёмка изоляции и отказов. До controls дистанционная запись отключена.

Оценка для одного разработчика с AI и переиспользованием готовых модулей: платформа 6–10 часов, адаптеры 8–13 часов, наблюдение 6–9 часов, управление/приёмка 6–8 часов. Сумма задач 26–40 часов; отдельно 2–4 часа на выбор/проверку upstream и 4–8 часов общего резерва. Итого 32–52 часа активной работы, ориентир 4–7 дней при 8 часах в день. Внешнее ожидание доступов/оборудования не входит. Это целевой бюджет до измерения темпа, не выполненный benchmark. Probe всех источников — 2–3 часа внутри платформы; первый сквозной демо на готовом решении — 4–8 часов внутри общего бюджета. Все исходные требования сохраняются. Desktop Chat остаётся условным: неподходящий AX требует пересмотра транспорта и оценки; его нельзя считать готовым по одному MCP bridge. [Единая оценка](../../delivery-estimate.md).

Приёмка: два разных Telegram аккаунта и два независимых Mac/daemon; одинаковые локальные cmux IDs не смешиваются. Проверить попытки B прочитать snapshot/history/replay, подписаться или отправить command/permission в A, включая deep link и revoked token. Проверить Desktop Chat, Desktop Code, обычный CLI и cmux; для каждой операции есть capability и фактический результат. Два Claude одного пользователя в разных surfaces, запрос разрешения в одном и Stop в другом; ввод адресуется выбранной сессии. Проверить поддельные initData, повтор команды, смену generation, закрытие surface, sleep/wake, рестарт relay/daemon, неполный JSONL, медленного клиента и поздний allow. Мобильная проверка минимум Telegram iOS и Android; Playwright не заменяет эти проверки.

Поставка daemon для пилота: versioned tarball с JS bundle, package metadata и SHA-256 checksum; Node.js 22+ устанавливается отдельно. Команды CLI `pair`, `start`, `hooks install`, `hooks uninstall` документируются. Установка проверяется на чистом macOS user profile; auto-update и нотарифицированный desktop installer вне релиза. Закрытие cmux отключает только cmux adapters; CLI/Desktop продолжают работать. AX helper поставляется как отдельный подписанный macOS app/helper с понятным Accessibility consent. Auto-start companion через LaunchAgent не включает cmux socket privileges; способ обновления/подпись проверяются в плане интеграций.

Нагрузочная приёмка: 20 owners × 1 daemon × 10 sessions; один открытый terminal snapshot/owner в секунду; 200 структурированных events/second суммарно в течение 30 минут. Цель p95 доставки hook event в подключённый UI ≤2 секунды; память relay не растёт без ограничения, noisy account не задерживает соседние. Это target для пилота; размер VM и фактические замеры фиксируются в acceptance report.

Rollback: отключить управление флагом, отозвать device token, остановить daemon; удалить только добавленные интеграцией hooks с сохранением остальных. Восстановление доступа к Claude не должно зависеть от relay. Коммиты в этой рабочей области запрещены пользовательской инструкцией.
