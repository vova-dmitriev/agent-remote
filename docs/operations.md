# Запуск relay и эксплуатация

Для личного запуска на Mac без оплаты хостинга используй [personal-launch.md](personal-launch.md). Ниже описано отдельное серверное развёртывание.

Сервис — один relay instance, один bot poller, PostgreSQL и Redis/BullMQ. Подробности кеша, очереди и восстановления — в [redis-bullmq.md](redis-bullmq.md). Владельцы определяются проверенными Telegram initData/device tokens, не полем userId от клиента. Приложение не имеет административного API чтения чужих сессий.

1. Создай Telegram-бота через BotFather, укажи HTTPS URL Mini App/menu button. BOT_TOKEN хранится только на relay.
2. Заполни `.env` по `.env.example`: BOT_TOKEN, DATABASE_URL, REDIS_URL, REDIS_PASSWORD, PUBLIC_ORIGIN, POSTGRES_PASSWORD, DOMAIN. Для compose DATABASE_URL должен указывать host `postgres` внутри его сети.
3. Собери приложение: `pnpm build`; запусти `pnpm start:server` либо `docker compose up -d --build` на выбранной инфраструктуре. DNS/ports 80/443 должны вести на Caddy. Сторонняя инфраструктура автоматически не создаётся.
4. Проверь `/health`; зайди из Telegram, привяжи Mac и проверь совместимость каждого источника. Включай input/permissions отдельно после проверки.

Для локальной разработки HTTP разрешён только для loopback origin при `ALLOW_INSECURE_LOCAL=1`. Auth всё равно требует настоящей подписи Telegram; тестового логина в production server нет. App token — в памяти браузера, 15 минут; после expiry приложение просит заново открыть Mini App. WS auth передаётся первым frame, не URL; app/device audiences раздельные.

Локальные проверки:

```sh
docker compose -f compose.test.yml up -d --wait
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm build
swift test --package-path apps/macos-helper
```

Test DB — отдельный порт 55432, случайные schemas для каждого теста. Test fixtures подписывают initData заведомо тестовым ключом и используют реальные HTTP/WS/SQL paths. Playwright подменяет только Telegram SDK/fixtures устройства; это не проверка физического Telegram iOS/Android.

Уведомления идут только после `/start` в private chat этого Telegram ID, без prompt/терминального текста. 429 учитывает retry_after, 403 отключает уведомления только соответствующего пользователя. Возможен повтор уведомления при неопределённом ответе Telegram, exactly-once не обещается.

События и dedup ограничены 24 часами/10 000 событий на device; есть периодическая очистка. Device snapshot содержит текущую историю состояния/permissions и может включать видимый текст выбранного источника. Оператор сервера имеет доступ к этим данным; TLS не является E2EE. Логи содержат только коды/операционные сообщения.

Backup: отдельное хранилище с доступом только оператора; срок хранения ≤7 дней. Скрипт `scripts/backup-db.sh` использует pg_dump внутри выбранного compose project (`COMPOSE_FILE`), имя базы задаётся `BACKUP_DATABASE` (по умолчанию `claude_remote`), а `scripts/restore-db.sh` восстанавливает только указанную чистую test/staging database. Не восстанавливай поверх production без отдельного решения.

Attachment bytes are private PostgreSQL data and are included in database backups. Live relay retention is 24 hours with a 50 MiB owner quota; backups retain their separately configured lifetime. The companion keeps verified private inputs for at most 24 hours and prunes them periodically. See [attachment storage and source boundaries](attachments.md).

Rollback: выключи REMOTE_INPUT_ENABLED/REMOTE_PERMISSIONS_ENABLED, отзови устройство, останови companion, удали только свои hooks. При unknown command outcome автоматической повторной отправки нет. Relay/daemon перезапуск не должен создавать повторный ввод. Старые токены не используют для переноса ownership; нужен revoke + новая pairing.
