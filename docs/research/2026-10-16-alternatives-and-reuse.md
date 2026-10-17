# Аналоги и переиспользование — 2026-10-16

Результат: есть готовые решения для удалённого Claude Code; сначала проверять их, а не автоматически реализовывать весь прежний план. Ни в одном из просмотренных проектов не подтверждено управление обычным существующим Claude Desktop **Chat**. Desktop Code и Chat остаются разными интеграциями.

Источник запроса: [переписка](https://chatgpt.com/s/t_6ad21f8af5d48191851dd79635200adb), доступен один ответ ассистента. Проверены README, root LICENSE, дерево и выбранные исходники; для cmux PR — API state. Ничего не устанавливалось и не запускалось; это source review, не runtime/security acceptance.

## Решение

1. Для проверки самого сценария сначала попробовать готовый [HAPI](https://github.com/tiann/hapi): CLI + телефон + Telegram Mini App уже объединены. Это кандидат для использования/форка, если подходит AGPL и ограничения подключения.
2. Для собственного сервиса с независимыми пользователями — переиспользовать MIT-модули по границам: frontend `cc-tg-hub`, hooks/PTY `CCGram`, cmux-клиент `cmux-tui`. Сохранить свой owner-scoped backend/протокол и заменить несовместимые методы.
3. Обычный Desktop Chat исследовать отдельно через локальный адаптер. MCP/Claude Code-интеграция не доказывает управление этим приложением.

Это рекомендация, не утверждённая замена архитектуры. По уточнению пользователя оценки пересчитаны для разработки с AI и адаптации готового кода: общий бюджет 32–52 часа активной работы, выбор/проверка upstream 2–4 часа. Экономию и совместимость нужно подтвердить первым сквозным прогоном, а не считать доказанными по README. [Единая оценка](../delivery-estimate.md).

## Что обнаружено

| Проект                                                                                  | Что уже есть / стоит брать                                                       | Почему не готовая замена всему сервису                                                                                                                        | Root license                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [HAPI](https://github.com/tiann/hapi)                                                   | Hub, CLI wrapper, web/Telegram Mini App, approvals, native clients               | Нет подтверждённого Desktop Chat attach; multi-account namespaces имеют общий base token и требуют отдельной оценки для недоверяющих друг другу пользователей | AGPL-3.0; проверять subtree notices              |
| [cc-tg-hub](https://github.com/rennf93/cc-tg-hub)                                       | React/Vite Mini App, broker/MCP frames, сессии, одноразовые callbacks Allow/Deny | Shared operator allowlist, а не per-user ownership; inbound зависит от development channels flag                                                              | MIT                                              |
| [CCGram](https://github.com/jsayubi/ccgram)                                             | Hooks, questions/permissions, transcript reader, headless PTY                    | PTY создаёт свой child, а не захватывает текущий TTY; нужны изменения логирования/идентичности и свой UI                                                      | MIT                                              |
| [cmux-tui](https://github.com/W4M-ai/cmux-tui)                                          | TypeScript cmux command layer, чтение/ввод terminal, существующие cmux sessions  | SSH/TUI, нет Telegram UI и source adapters для Desktop Chat                                                                                                   | MIT                                              |
| [Claude Code Telegram Bridge](https://github.com/rsprowler/claude-code-telegram-bridge) | Python Mini App/SSE, Telegram auth, session cards/approvals                      | README прямо указывает single-user OWNER_ID; создаёт SDK sessions, не attach исходного Desktop Chat                                                           | MIT                                              |
| [CCBot](https://github.com/six-ddc/ccbot)                                               | Transcript monitor, terminal parser, Telegram topics                             | Python/tmux; интеграция с нашей моделью потребует адаптации                                                                                                   | MIT                                              |
| [Happy](https://github.com/slopus/happy)                                                | Готовая альтернатива для мобильного доступа; пример relay/CLI архитектуры        | Не подтверждены Telegram Mini App и Desktop Chat attach для наших требований; большой проект                                                                  | MIT в root; notices отдельных packages проверять |

## Конкретные кандидаты из исходников

### cc-tg-hub: UI и схема обмена

Взять как кандидатов [app/src/pages/SessionDetail.tsx](https://github.com/rennf93/cc-tg-hub/blob/f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099/app/src/pages/SessionDetail.tsx), `app/src/pages/SessionsPage.tsx`, `app/src/lib/telegram/`, [shared/src/frames.ts](https://github.com/rennf93/cc-tg-hub/blob/f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099/shared/src/frames.ts). Frontend React/Vite подходит к выбранному стеку. Session detail в основном управляет метаданными/состоянием и ссылается на Telegram topic; это не готовый полноценный live transcript viewer.

В [broker/src/api.ts](https://github.com/rennf93/cc-tg-hub/blob/f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099/broker/src/api.ts) `isAuthed()` возвращает boolean, а session list после него берёт весь `store.list()`. В [broker/src/state.ts](https://github.com/rennf93/cc-tg-hub/blob/f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099/broker/src/state.ts) SessionRecord не содержит ownerId. Allowlist здесь разрешает операторам общий доступ: это ожидаемая модель проекта, но она не выполняет нашу изоляцию. Не копировать backend auth/state как готовую multi-tenant основу. README требует `--dangerously-load-development-channels server:cc-tg-hub`: нельзя выдавать это за обычный production transport без условий preview/allowlist.

### CCGram: отдельные hooks/PTY-компоненты

Кандидаты: [permission-hook.ts](https://github.com/jsayubi/ccgram/blob/75b38e1bab4af411b40b4e589d050786eb65ceca/permission-hook.ts), [src/utils/transcript-reader.ts](https://github.com/jsayubi/ccgram/blob/75b38e1bab4af411b40b4e589d050786eb65ceca/src/utils/transcript-reader.ts), [src/utils/pty-session-manager.ts](https://github.com/jsayubi/ccgram/blob/75b38e1bab4af411b40b4e589d050786eb65ceca/src/utils/pty-session-manager.ts).

PTY module явно создаёт headless Claude child через node-pty; не attach существующего bare-terminal process и не готовый локальный passthrough-wrapper нашего дизайна. Он сохраняет raw terminal output в logs, использует name-based handles и допускает pass-through неизвестной key name. Перед включением нужны наши ограничения retention/redaction, session identity и allowlist input. Permission UI содержит дополнительные режимы: в нашем протоколе сохранить только одноразовые allow/deny.

[src/utils/ghostty-session-manager.ts](https://github.com/jsayubi/ccgram/blob/75b38e1bab4af411b40b4e589d050786eb65ceca/src/utils/ghostty-session-manager.ts) использует Ghostty/AppleScript и регистрацию по cwd. Это не доказательство поддержки cmux либо Desktop Chat; такой route не переносить как verified targeting.

### cmux-tui: клиент cmux, UI не переносить целиком

[src/index.ts](https://github.com/W4M-ai/cmux-tui/blob/bb0fea83d2fcdb5f172e651cf0f4d81a37329eb8/src/index.ts) содержит cmux вызовы, polling и TUI в одном большом файле. Выделить минимальный CmuxClient с нашими Target UUID и timeout/limits; эвристики статусов и approve macros не превращать в структурированные permissions. Это самостоятельный MIT-проект, не тот же код, что официальный cmux PR.

### HAPI: проверить готовое решение до форка

[Namespace guide](https://github.com/tiann/hapi/blob/317e39a0bb9c768ce135f3fbe3157f9e3fefeebe/docs/guide/namespace.md) описывает один CLI_API_TOKEN и суффиксы `:alice`/`:bob`. Это хороший кандидат для небольшого доверенного использования; публичная регистрация независимых пользователей и раздельные секреты/ownership не считаются доказанными. В [hub/src/web/middleware/auth.ts](https://github.com/tiann/hapi/blob/317e39a0bb9c768ce135f3fbe3157f9e3fefeebe/hub/src/web/middleware/auth.ts) есть namespace в JWT; это само по себе не заменяет проверку выдачи namespace identity. Проверить, может ли обладатель base token выбирать чужой namespace, до использования как multi-user service.

Для готового использования отдельно проверить `hapi claude`, переход local/remote, permissions, Telegram Mini App, два независимых пользователя и потерю сети. Не менять текущие Claude configs и не передавать реальные bot tokens в рамках source review.

## Лицензии и происхождение

MIT root LICENSE подтверждены у пяти проектов из переписки и Happy. Для заимствованных частей сохранить полный copyright/license notice, upstream URL, commit SHA и список изменённых файлов в THIRD_PARTY_NOTICES; проверить notices конкретных файлов и dependencies. Коммерческое использование допускается текстом MIT, однако атрибуцию нельзя удалять.

HAPI root — AGPL-3.0. Это другой режим: при изменении покрытого сетевого сервиса учитывать предложение corresponding source удалённым пользователям, описанное в §13 LICENSE. Не копировать AGPL server-код в проект с расчётом на MIT; проверять лицензию выбранного subtree, а не только GitHub badge.

Официальный [cmux PR #3411](https://github.com/manaflow-ai/cmux/pull/3411) на момент проверки **open, merged=false**, обновлён 2026-09-30. В нём есть Swift remote server и Vue web terminal. Root LICENSE текущего cmux содержит GPL-3.0-or-later и отдельные BUSL-1.1 server directories; для PR проверить именно его revision/file notices. Не считать весь upstream MIT и не брать код PR как подтверждённую часть установленного релиза.

Проверенные лицензии: [rennf93/cc-tg-hub](https://github.com/rennf93/cc-tg-hub/blob/f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099/LICENSE), [jsayubi/ccgram](https://github.com/jsayubi/ccgram/blob/75b38e1bab4af411b40b4e589d050786eb65ceca/LICENSE), [W4M-ai/cmux-tui](https://github.com/W4M-ai/cmux-tui/blob/bb0fea83d2fcdb5f172e651cf0f4d81a37329eb8/LICENSE), [tiann/hapi](https://github.com/tiann/hapi/blob/317e39a0bb9c768ce135f3fbe3157f9e3fefeebe/LICENSE), [slopus/happy](https://github.com/slopus/happy/blob/bd6348d50aadfc88736499c8e51e4cec10c9343b/LICENSE). [Текущая лицензия cmux](https://github.com/manaflow-ai/cmux/blob/main/LICENSE).

## Переход к имплементации

По последующему запросу пользователя подготовлен [основной план](../superpowers/plans/2026-10-16-claude-remote-implementation.md): плановый путь — три pinned MIT upstream, свой owner-scoped relay и отдельный Desktop helper. HAPI остаётся справочной альтернативой; его установка не блокирует этот путь. Ниже сохранена исходная рекомендация проверки как контекст исследования.

## Исходная рекомендация следующего этапа

До реализации нового backend выделить 2–4 часа на ограниченную проверку HAPI и MIT-компонентов в изолированном стенде. Source review уже выполнен; не тратить этот бюджет на повторное чтение всех репозиториев. Выбрать один основной кандидат, проверить запуск, локальный/удалённый ввод, permissions и пригодность ownership; полная изоляционная приёмка остаётся в этапе управления/приёмки. Результат — один выбранный путь: использовать готовое решение; форк с совместимой лицензией; либо собственный backend с выбранными upstream modules.

Критерии: две сессии; два пользователя не видят/не контролируют друг друга; реальный local/remote ввод; late permission и reconnect; Desktop Chat отдельно принят или отмечен нерешённым. После этого обновить implementation plan и оценку. Не устанавливать все проекты подряд, не объединять их polling loops и auth stores и не смешивать код без указания происхождения.

## Зафиксированные версии

| Репозиторий                             | Commit SHA                                 | Root SPDX  |
| --------------------------------------- | ------------------------------------------ | ---------- |
| `jsayubi/ccgram`                        | `75b38e1bab4af411b40b4e589d050786eb65ceca` | `MIT`      |
| `slopus/happy`                          | `bd6348d50aadfc88736499c8e51e4cec10c9343b` | `MIT`      |
| `rennf93/cc-tg-hub`                     | `f4abecc196e0a8ddb6ca0cd9177c9a16a2e9b099` | `MIT`      |
| `six-ddc/ccbot`                         | `9d7ab9721f09d748db242c22d04aa494cbebc72d` | `MIT`      |
| `tiann/hapi`                            | `317e39a0bb9c768ce135f3fbe3157f9e3fefeebe` | `AGPL-3.0` |
| `rsprowler/claude-code-telegram-bridge` | `694b14c3bb437edcf927dfd37550b3a9ddf958ef` | `MIT`      |
| `W4M-ai/cmux-tui`                       | `bb0fea83d2fcdb5f172e651cf0f4d81a37329eb8` | `MIT`      |
