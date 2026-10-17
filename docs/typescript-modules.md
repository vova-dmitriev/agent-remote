# Локальные TypeScript-модули

По запросу «перепиши эти части на тайпскрипте» реализован локальный слой из аналогов. Это подключаемые библиотеки, а не запущенный Telegram-сервис.

| Модуль                                          | API                                                                                                                         | Поведение                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/daemon/src/code/transcript-reader.ts`     | `new TranscriptReader({ path, allowedRoot })`, `readNext()`                                                                 | Точный hook-provided JSONL path, realpath/root guard, file identity + prefix/cursor checks, rotate/truncate, partial UTF-8, сериализация чтений, ограниченные line/read/text/dedup buffers; только user/assistant text |
| `apps/daemon/src/commands/permission-broker.ts` | `open`, `pending`, `resolve`, `cancelSession`, `close`, `permissionHookOutput`                                              | Одна allow/deny на request+generation, максимум 45 секунд, timeout/disconnect → local; нет Always/updatedPermissions                                                                                                   |
| `apps/daemon/src/code/pty-session-manager.ts`   | `start`, `confirmSession`, `sendPrompt`, `interrupt`, `writeLocal`, `resize`, `onData`, `disconnectRemote`, `stop`, `close` | Только собственный дочерний процесс; generation и сменяемый remote lease; разрыв удалённой связи сохраняет локальный процесс; stdout не хранится и не логируется                                                       |
| `apps/daemon/src/cmux/client.ts`                | `readScreen`, `pasteAndSubmit`, `sendEscape`                                                                                | Все три UUID обязательны; shell:false; текст через stdin; snapshots ≤64 KiB/200 строк; timeout 5 секунд с SIGKILL для зависшего CLI                                                                                    |
| `packages/protocol/src/index.ts`                | `HistoryMessage`, `CmuxTarget`, `validatePrompt`                                                                            | Prompt ≤16 KiB UTF-8, LF/TAB допустимы, terminal control bytes отклоняются                                                                                                                                             |

## Пример локальной интеграции

```ts
import { TranscriptReader } from './dist/apps/daemon/src/code/transcript-reader.js';
import { PermissionBroker, permissionHookOutput } from './dist/apps/daemon/src/commands/permission-broker.js';
import { PtySessionManager } from './dist/apps/daemon/src/code/pty-session-manager.js';

// Paths come from a validated local hook, never from a remote request.
const reader = new TranscriptReader({
  path: '/Users/example/.claude/projects/project/session.jsonl',
  allowedRoot: '/Users/example/.claude',
});
const messages = await reader.readNext();

const permissions = new PermissionBroker();
// requestId must be unique for every hook invocation.
const answer = permissions.open({
  requestId: crypto.randomUUID(),
  sessionId: 'session-id',
  generation: 'generation-id',
  toolName: 'Bash',
  input: { command: 'pwd' },
  expiresAt: Date.now() + 45_000,
});
// A future authenticated transport resolves the exact requestId+generation.
permissions.cancelSession('session-id', 'generation-id');
const hookOutput = permissionHookOutput(await answer); // {} => local prompt remains responsible.
permissions.close();

const terminal = new PtySessionManager(); // fixed local executable: claude
const local = terminal.start({ id: 'terminal-1', cwd: '/absolute/project' });
const output = terminal.onData(local, (text) => process.stdout.write(text));
// Only a trusted hook identifying this exact child may confirm its Claude session.
const remote = terminal.confirmSession(local, 'hook-confirmed-claude-session-id');
terminal.sendPrompt(remote, 'Покажи git status');
terminal.disconnectRemote(local); // old remote lease is now invalid
// writeLocal()/resize() keep working until the local launcher calls stop()/close().
output.dispose();
terminal.close();
```

`confirmSession` — точка интеграции, а не реализованная проверка hook identity. Auth, ownerId, device/connector routing, TTL/dedup удалённых команд и подтверждение child binding должен обеспечить daemon/relay из следующих tasks. Эти библиотеки нельзя напрямую выставлять как публичный RPC.

История читается порциями до 1 MiB; вызывающий продолжает `readNext()` для больших файлов. Dedup хранит последние 10 000 IDs, поэтому повтор очень старых записей после rotation возможен. Reader рассчитан на append-only Claude journal с rotation/truncation. Проверяет первые 4 KiB и 64 байта перед cursor; при изменении metadata без роста файла начинает чтение заново. Произвольная перезапись середины большого файла с одновременным ростом и неизменными prefix/anchor может остаться незамеченной. Полная проверка такого сценария требует повторного чтения всей уже прочитанной истории.

Root guard рассчитан на принадлежащую локальному пользователю директорию Claude; он не является OS sandbox для дерева, которое параллельно меняет атакующий.

`sendPrompt()` использует bracketed paste + Enter. Это проверено на контролируемом PTY fixture; реальное поведение установленного Claude CLI пока не проверялось. Обычный уже запущенный `claude` нельзя подключить к stdin задним числом этим модулем. Для него далее нужны hooks/history, а для отправки — локальный launcher. Desktop Chat/Code Accessibility не реализован.

## Проверки и решения

Тесты используют временные JSONL-файлы, отдельный CLI fixture и настоящий PTY с Node.js child. Реальные чаты, cmux surfaces и пользовательские Claude-сессии не читались и не получали ввод.

- RED → GREEN: validator, permissions, JSONL; затем cmux/PTY.
- PTY integration воспроизвёл `posix_spawnp failed.`: packaged macOS `spawn-helper` имел mode 0644. После восстановления owner execute bit тест проходит. `postinstall` делает исправление воспроизводимым внутри локального `node_modules`.
- Работа ведётся в отдельно созданном репозитории, ветка `feat/typescript-parts`. Коммитов нет. Worktree из unborn HEAD создать нельзя; правило пользователя запрещает создавать commit для этого. Цена решения — изменения пока существуют только в этой папке.
- Прежний план полного сервиса выполняется частично: авторизованный сейчас объём — выбранные локальные модули. Цена — Telegram/backend/Desktop требуют следующего этапа.
- Application code переписан под Node.js. Нативный PTY остаётся зависимостью `node-pty`; postinstall tooling — короткий `.mjs`. Цена — сборка/установка native dependency на неподдерживаемой платформе может требовать compiler toolchain.
- Базовые типы и validator добавлены раньше полного wire protocol, чтобы модули имели общий контракт. Цена — будущие protocol schemas нужно согласовать с этими экспортами.

## Финальное ревью

Независимый reviewer обнаружил три Important-дефекта; для каждого сначала воспроизведён FAIL, затем исправление прошло тот же тест:

1. Перезапись JSONL того же размера и truncate/regrowth пропускали новые сообщения при одинаковом cursor anchor. Добавлены prefix check и metadata check; оба regression fixtures проходят.
2. PTY child мог игнорировать SIGHUP после `stop()`. Локальный stop/close теперь отправляет SIGKILL и сохраняет session в учёте до onExit. Удалённый disconnect по-прежнему сохраняет процесс.
3. cmux CLI мог игнорировать SIGTERM и переживать timeout. `execFile` теперь использует SIGKILL; отдельный fixture проверяет фактическое завершение.

Проверки: `npm test` — 26/26; `npm run typecheck` и `npm run build` — exit 0. Отложенных minor findings нет.

Решения по границам ревью: auth/owners/command persistence/hooks/Desktop остаются последующими tasks; реальный Claude/cmux ввод и Windows/Linux не проверены. Цена — эти возможности ещё нельзя считать готовыми. Arbitrary concurrent filesystem mutation и редактирование середины растущего журнала требуют отдельного режима проверки; текущий reader ориентирован на append-only Claude history. Цена — такой нетипичный rewrite может пропустить запись.

Рабочая папка и локальный execution ledger сохранены: коммитов нет, поэтому удаление scratch уничтожило бы единственную запись выполнения. Изменения не публиковались и не сливались.
