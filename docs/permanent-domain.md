# Постоянный адрес личного Mini App

`npm run personal` поддерживает постоянный HTTPS-адрес через локально управляемый Cloudflare Tunnel. Mac должен оставаться включённым. Без постоянных настроек launcher использует прежний временный Quick Tunnel.

До запуска нужны активная DNS-зона Cloudflare, созданный tunnel, локальный credentials JSON и DNS-запись выбранного hostname, направленная в этот tunnel. Launcher не создаёт аккаунт, tunnel или DNS-записи и не требует Cloudflare API token.

Добавь в локальный `.env` все три значения:

```dotenv
PERSONAL_PUBLIC_ORIGIN=https://agent.example.com
PERSONAL_TUNNEL_ID=YOUR-TUNNEL-UUID
PERSONAL_TUNNEL_CREDENTIALS_FILE=/absolute/private/path/YOUR-TUNNEL-UUID.json
```

`PERSONAL_PUBLIC_ORIGIN` — HTTPS origin публичного DNS-имени без логина, порта, пути, query или fragment. `PERSONAL_TUNNEL_ID` — UUID tunnel. `PERSONAL_TUNNEL_CREDENTIALS_FILE` — абсолютный путь к credentials JSON, созданному Cloudflare для этого tunnel. Храни этот файл вне репозитория с правами `0600`; его содержимое не нужно вставлять в `.env`.

Частичная или неверная конфигурация останавливает запуск. Автоматического перехода на временный URL при ошибке постоянного tunnel нет. Чтобы вернуться к Quick Tunnel, удали все три настройки.

Launcher создаёт приватный `.local-data/cloudflared.yml` (`0600`, YAML-совместимый JSON): только точный hostname направляется на `http://127.0.0.1:3040`, остальные запросы получают `404`. Файл содержит путь к credentials, но не их содержимое. Запускается установленный `cloudflared`:

```sh
cloudflared tunnel --no-autoupdate --config /absolute/path/to/.local-data/cloudflared.yml run YOUR-TUNNEL-UUID
```

Telegram menu button и notification worker обновляются только после успешного публичного HTTPS `/health`. Для кнопки «Открыть» в списке диалогов отдельно сохрани этот же адрес в BotFather → Open → Agent Remote → Mini Apps → Main App; подробности в [telegram-main-app.md](telegram-main-app.md). При ошибке запуска relay и дочерний tunnel закрываются. Перезапуск сохраняет адрес, локальную БД и подключение companion; DNS и credentials должны оставаться действующими.

[Cloudflare: создание локального tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/), [ingress configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/).
