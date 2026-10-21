# Agent Remote на Linux-ВМ для нескольких пользователей

Всё работает на одной ВМ: relay, бот, PostgreSQL, Redis и агенты (Claude Code, Codex) с проектами. У пользователей
только клиенты: Telegram Mini App, приложение на Маке и расширение Chrome. Каждый видит только сессии, которые создал
сам. Устройство спроектировано в [спецификации](superpowers/specs/2026-10-21-linux-vm-multi-user-design.md).

## Как это устроено

- Сервис `agents` запускает супервизор (`remote supervise`). Для каждого, кто открыл Mini App, он получает от relay
  устройство (`POST /operator/devices`, токен оператора) и держит этому человеку отдельный демон с
  `CLAUDE_REMOTE_HOME=/data/users/<id>` и `REMOTE_MULTI_USER=1`.
- Relay разделяет данные по паре «владелец + устройство», поэтому сессии одного пользователя другим не видны.
- Claude Code и Codex один раз входят по подписке в контейнере `agents`; все пользователи работают через этот вход.
- Проекты — папки в `/data/projects`. В «Новой сессии» они видны всем; первая сессия пользователя создаётся там.
- Claude-сессии идут в `tmux` внутри контейнера, Codex — в собственном app-server каждого демона.

Ограничение, принятое владельцем: все агенты работают от одного Linux-пользователя на общих файлах. Агент одного
пользователя технически может прочитать проект другого; в приложении каждый видит только свои сессии.

## Развёртывание

1. ВМ с Docker и Compose, DNS-имя, указывающее на ВМ, открытые порты 80 и 443.
2. `.env` по `.env.example`: `BOT_TOKEN`, `DATABASE_URL` (хост `postgres`), `REDIS_PASSWORD`, `POSTGRES_PASSWORD`,
   `DOMAIN` и `REMOTE_OPERATOR_TOKEN` — длинный случайный секрет (`openssl rand -hex 32`).
3. Запуск: `docker compose -f compose.vm.yml up -d --build`.
4. Один раз войти в подписки внутри контейнера агентов:

   ```sh
   docker compose -f compose.vm.yml exec agents claude        # вход в Claude, затем /exit
   docker compose -f compose.vm.yml exec agents codex login --device-auth
   ```

   Вход хранится в томе `agents_home` и переживает перезапуски.
5. Положить проекты: `docker compose -f compose.vm.yml exec agents git clone <url> /data/projects/<имя>`.
6. В BotFather указать Mini App `https://<DOMAIN>`. Каждый пользователь открывает бота, нажимает Start и «Open
   Agent Remote»; через 10 секунд у него появляется своё устройство, и он может создать первую сессию в проекте.

## Эксплуатация

- Журналы: `docker compose -f compose.vm.yml logs -f agents relay`.
- Сессии Claude можно посмотреть вживую: `docker compose -f compose.vm.yml exec agents tmux ls` и `tmux attach -t …`.
- Отозвать доступ пользователя: удалить его устройство в приложении и папку `/data/users/<id>`; при следующем входе
  он получит новое.
- `/operator/*` снаружи всегда отвечает 404 (Caddy); супервизор ходит в relay напрямую по сети контейнера.
- Резервные копии базы — как в [operations.md](operations.md). Тома `agents_home` (вход в подписки) и `agents_data`
  (проекты и состояние демонов) копируются отдельно.
