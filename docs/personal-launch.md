# Личный запуск без платного сервера

Всё работает на твоём Mac: relay, PostgreSQL, Redis/BullMQ, Telegram bot и companion. Cloudflare Quick Tunnel выдаёт бесплатный HTTPS-адрес для Mini App без покупки домена и регистрации аккаунта. Адрес может меняться при перезапуске; launcher обновляет кнопку Mini App в боте автоматически. Mac должен оставаться включённым и подключённым к интернету. Для своего постоянного адреса настрой [именованный туннель](permanent-domain.md); тогда URL сохраняется при перезапусках.

Нужны уже установленные Node.js/Docker Desktop и клиент туннеля:

```sh
brew install cloudflared
npm run personal
```

Первый запуск создаст `.env` с правами 0600. Вставь свой токен в строку `BOT_TOKEN=` этого локального файла, затем повтори `npm run personal`. Токен в чат не отправляй.

При первом запуске launcher сам откроет Telegram со ссылкой подключения. Нажми **Start** в боте, затем **Подключить** в окне на Mac: там показан Telegram ID аккаунта. Если окно macOS недоступно, подтверждение появится в терминале (`yes/no`). После подтверждения companion запустится автоматически. Повторный запуск использует сохранённое подключение.

Ссылка действует пять минут. В неё входит только одноразовый код; локальный proof и токен устройства в ссылку не попадают. Если Telegram не открылся, скопируй напечатанную ссылку или введи код в Mini App. Отказ, Ctrl+C и истечение срока отменяют подключение.

Чтобы повторить отменённое подключение или подключить Mac после отзыва доступа при работающем launcher:

```sh
node apps/daemon/bin/remote.mjs connect
```

Команда `connect` начинает новое подтверждение и сохраняет прежний конфиг до успешного подключения. Если у аккаунта уже есть активный Mac, сначала отзови его доступ в приложении; удалять конфиг вручную не нужно.

Для другого relay укажи адрес после `connect`. На отдельном relay задай `BOT_USERNAME`, чтобы CLI мог открыть Telegram; команда `pair <relayUrl>` сохраняет ручной ввод кода.

Для управляемого Claude Code открой другой терминал:

```sh
node /absolute/path/claude-remote/apps/daemon/bin/remote.mjs hooks install
node /absolute/path/claude-remote/apps/daemon/bin/remote.mjs claude
```

Companion обращается к relay через loopback, поэтому смена адреса туннеля не требует новой pairing. База хранится в отдельном Docker volume `claude-remote-local_personal_postgres`; test database на порту 55432 её не затрагивает. Остановка launcher завершает relay/companion/туннель, база сохраняется.

Этот вариант не требует платежей за хостинг, домен или сертификат. Существующая подписка Claude остаётся нужна. Quick Tunnel не даёт SLA; после перезапуска открой Mini App заново через кнопку бота.

Источник: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Redis setup, caching and queue recovery: [redis-bullmq.md](redis-bullmq.md).
