# Установка companion на Mac

Требуются macOS 13+, Node.js 22.12+ (сборка проверена на Node 22.12 arm64), установленный Claude Code. cmux необязателен.

Из исходников:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:helper
node apps/daemon/bin/remote.mjs pair https://your-domain.example
node apps/daemon/bin/remote.mjs hooks install
node apps/daemon/bin/remote.mjs start
```

Сокращение команды в своём shell:

```sh
alias remote='node /absolute/path/claude-remote/apps/daemon/bin/remote.mjs'
```

Pairing: открой бота в Telegram, `/start`, открой Mini App, введи код с Mac; затем проверь показанный Telegram ID в терминале и введи `yes`. Device token остаётся только в `~/.claude-remote/device.json` (0600), local hook key — в `local.key` (0600), hook socket — 0600. Companion подключается исходящим WSS. Публичный порт Mac не открывается.

Для реального ввода после compatibility checks запусти companion с флагами:

```sh
REMOTE_INPUT_ENABLED=1 REMOTE_PERMISSIONS_ENABLED=1 remote start
```

Такие же флаги включаются на relay. По умолчанию оба выключены. Они разрешают только возможности проверенных локальных bindings.

## Terminal

Обычный `claude` после установки hooks отдаёт события и историю. Уже запущенные сессии могут требовать resume/restart, чтобы загрузить hooks.

Для отправки сообщений с телефона:

```sh
remote claude
remote claude --resume SESSION_ID
```

Перед resume закрой прежний frontend этой сессии. Wrapper создаёт собственный PTY и передаёт локальные stdin/stdout/resize. The remote API can create a session in an existing verified project or restart an exactly verified native Claude process through fixed owned launchers; it cannot run arbitrary shell commands. Потеря relay или companion отключает удалённый ввод; локальный процесс продолжает работать. После полной перезагрузки companion может потребоваться заново подключить wrapper/resume: неизвестная привязка не угадывается.

Локальный settings-файл допускается явно:

```sh
remote claude --settings /absolute/path/settings.json
```

## cmux

Запусти внутри выбранной cmux surface:

```sh
remote cmux --window WINDOW_UUID
```

Workspace/surface UUID берутся из `CMUX_WORKSPACE_ID`/`CMUX_SURFACE_ID`; window UUID передаётся явно или через `CMUX_WINDOW_ID`. Операция создаёт управляемый Claude child в этой панели, не перехватывает существующий shell. Снимок выбранной панели читается через cmux CLI. Ввод адресуется собственному Claude child, поэтому после его выхода не попадает в shell. Для старой сессии используй `--resume SESSION_ID` после завершения прежнего frontend. `allowAll` не включается.

## Claude Desktop

```sh
remote desktop bind chat
remote desktop bind code
```

Предварительно войди в установленный Claude Desktop, выбери существующий чат и сделай окно активным. Стабильная chat/session identity, composer и доступные сообщения проверяются helper. Если не удаётся проверить привязку, источник сообщает `needs_setup`, а управление остаётся выключенным. Непустой composer не перезаписывается. Chat не получает Code permissions или terminal snapshot. Desktop Code требует реальный session UUID из UI; tool permissions выключены, пока не подтверждена связь с живыми Code hooks. Реальная совместимость обоих Desktop режимов пока не подтверждена.

Helper находится в `artifacts/ClaudeRemoteBridge.app`; при необходимости добавь его в System Settings → Privacy & Security → Accessibility вручную. Локальная сборка подписывается ad-hoc; Developer ID signing задаётся через `CODESIGN_IDENTITY`. Нотарифицированный публичный installer пока не выпускался. Реальный Desktop Chat/Code compatibility gate требует вошедшего аккаунта и тестового чата.

## Архив

Codex CLI and Mac app setup is documented separately in [Codex connections](codex.md). Use `remote codex` from an ordinary terminal, or `remote codex connect desktop` for already open Mac chats. An existing standalone CLI without a compatible owner socket requires an explicit managed resume after closing its old frontend.

`pnpm package:daemon` создаёт tar.gz + SHA-256 в `artifacts/`. Он содержит JS, native dependencies и helper для текущих platform/architecture/Node ABI. Проверь checksum перед распаковкой. Для другой платформы/Node ABI установи зависимости заново по lockfile, не используй неподходящий native binary.

Архив не содержит `.env`, local device state, ключей или чатов. Node.js устанавливается отдельно. В готовом архиве зависимости и `dist/` уже присутствуют: повторять install/build не требуется.

Для проверенной сборки macOS arm64 / Node 22 (ABI 127), из папки с архивом:

```sh
shasum -a 256 -c claude-remote-0.1.0-darwin-arm64-node127.tar.gz.sha256
mkdir -p claude-remote
tar -xzf claude-remote-0.1.0-darwin-arm64-node127.tar.gz -C claude-remote
cd claude-remote
node apps/daemon/bin/remote.mjs pair https://your-domain.example
node apps/daemon/bin/remote.mjs hooks install
REMOTE_INPUT_ENABLED=1 REMOTE_PERMISSIONS_ENABLED=1 node apps/daemon/bin/remote.mjs start
```

Проверка архива из исходного репозитория: `pnpm verify:archive` — checksum, отсутствие private state, распаковка, CLI entrypoint, native SQLite и реальный PTY. Проверка Docker: `pnpm smoke:image` после `docker build -t claude-remote:local-test .`; использует только отдельную test database.

## Удаление

```sh
remote hooks uninstall
```

Удаляются только hook entries с маркером Claude Remote; чужие hooks и настройки сохраняются. Установщик сохраняет backup перед изменением. Затем останови companion и отзови Mac в Mini App. Локальные Claude процессы не зависят от relay.
