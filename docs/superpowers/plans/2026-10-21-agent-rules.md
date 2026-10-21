# Agent Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shell commands of Claude Code and Codex that match an owner's rule stop and ask the owner (❗) in the app or Telegram — Allow once, Allow always, Deny, deny after 10 minutes — with a Rules page per project and session.

**Architecture:** Rules live in one JSON file on the Mac shared by every daemon of the OS user. Each PreToolUse hook (Claude and Codex) reaches the daemons as today; a daemon matches the command against the rules in force and, on a match, opens a request on the existing `PermissionBroker` (rule requests wait up to 10 minutes) that the app shows as a permission card and Telegram as a ❗ message with answer buttons. Rules are listed and changed through a request/response pair like the usage report.

**Tech Stack:** TypeScript, zod, NestJS relay, BullMQ notifications, React Mini App (FSD, Tailwind v4), Playwright, Vitest; Claude Code 2.1.305 and codex-cli 0.149.0 hooks.

**Spec:** `docs/superpowers/specs/2026-10-21-agent-rules-design.md` (approved: "да").

## Global Constraints

- A matched command never runs without the owner's answer; no answer in 10 minutes (`RULE_ANSWER_TIMEOUT_MS = 600_000`) means deny.
- Hook timeouts for PreToolUse rise to 660 s (Claude `timeout`, Codex `timeoutSec`) so the hook, not the agent, decides at 10 minutes (verified: a timed-out Claude hook lets the command run).
- Bypass sessions (Claude `permission_mode = bypassPermissions`; Codex `approval_policy = "never"`) ignore project rules and obey session rules.
- Agent Remote not running → commands run unchecked (hook answers with no decision).
- _Allow always_ stores the exact command text on the scope of the rule that matched.
- Project = git repository root of the session's `cwd`, else the `cwd`.
- Deny reason text: `Agent Remote rule «<name>»: denied by the owner` / `Agent Remote rule «<name>»: no answer in 10 minutes` (Codex requires a non-empty reason).
- Repo rules: `as const` vocabulary in `packages/protocol/src/rules/values.ts`, ownership checks on every path, Drizzle-only server data access, `apps/mini-app/AGENTS.md`, ≤6 files per directory, ≤200 lines in `apps/daemon/src/local`, synthetic fixtures, staged validation on commit.
- Relay protocol bump to 7 (`RelayProtocolFeature.Rules`), relay before daemons.

## Review Focus

1. **Two daemons, one answer:** with the CLI daemon and the desktop companion both receiving the hook, an Allow given in either app wins; the other daemon's card disappears; the owner is asked once per surface, never twice in one app.
2. **Allow must win the hook fan-out:** an allow is not an empty answer to `deliverHook` (else the other daemon times out and denies).
3. **Rules file edited from two daemons:** concurrent saves never lose a rule (write by atomic rename after re-reading).
4. **Commands that look alike:** `psql -c "DELETE FROM t WHERE id=1"` is not stopped by the DB rule; `psql -c "delete from t"` (lower case, no WHERE) is.
5. **Subagent tool calls** go through the same check as the main agent's.

---

### Task 1: Protocol

**Files:** `packages/protocol/src/rules/{values.ts,schemas.ts}`, `packages/protocol/src/index.ts`, `session/schemas.ts` (permission `rule`, session `permissionMode`, frames), `session/command-values.ts` (`AllowAlways`), `connection/values.ts`, `connection/protocol-version.ts`, `local/{client-values,local-client}.ts`; test `tests/protocol/rules.test.ts`.

**Produces:**

- `RuleScopeKind = { Project: 'project', Session: 'session' }`, `ReadyRule = { Database, RemoveOutsideProject, ForcePush, DeployMigrations, Secrets }` (values `database`, `rm_outside_project`, `force_push`, `deploy_migrations`, `secrets`), `RuleAction = { Toggle, Compile, SaveOwn, Delete, ForgetCommand }`.
- `ruleSchema = { id, name, ready: ReadyRule | null, sentence: string | null, patterns: string[] (1..20, each ≤ 512) }`; `ruleScopeSchema = { kind, key }` (key = project root path or session id); `rulesViewSchema = { projects: [{ root, label, rules, allowed: string[] }], session: { id, root, bypass: boolean, rules, fromProject: Rule[], allowed } | null }`.
- `rulesRequestSchema` = discriminated union on `action`: Toggle `{ scope, ready, on }`, Compile `{ sentence }` → `{ name, patterns }`, SaveOwn `{ scope, name, sentence, patterns }`, Delete `{ scope, id }`, ForgetCommand `{ scope, command }`; plus a read `{ action: 'view', sessionId: string | null }` (`RuleAction.View = 'view'`).
- Permission request gains `rule?: { id, name, scope: RuleScopeKind }`; `PermissionDecision.AllowAlways = 'allow_always'` added to `RemotePermissionDecision`.
- Session gains optional `permissionMode: string (≤ 64)`.
- `FrameType.RulesRequest/RulesResult`, `LocalOperation.Rules`, `RelayProtocolFeature.Rules = 7`.

- [ ] Test: schemas accept a project view with a ready and an own rule; reject an own rule with 0 or 21 patterns; a permission with `rule` and a remote decision `allow_always` parse; `RELAY_PROTOCOL.Current === 7`.
- [ ] Implement; update the public API snapshot (`-u`); commit.

### Task 2: Rules store and matcher (daemon, pure)

**Files:** `apps/daemon/src/rules/{store.ts,ready-rules.ts,match.ts,project.ts}`; tests `tests/daemon/rules/*.test.ts`.

**Interfaces:**

- `RULES_FILE = join(defaultStateDirectory(), 'rules.json')` (0600).
- `class RulesStore { constructor(path); read(): RulesFile; update(change: (file: RulesFile) => void): RulesFile }` — `update` re-reads, applies, writes temp + rename.
- `READY_RULES: Record<ReadyRule, { name: string; patterns: string[] }>` — names in English (UI translates by `ready` key).
- `rulesInForce(file, { sessionId, root, bypass }): { rule, scope }[]` — session rules always, project rules unless `bypass`.
- `matchCommand(command: string, inForce, file): { rule, scope } | null` — case-insensitive regex search; an exact command on the scope's `allowed` list never matches.
- `projectRoot(cwd: string): Promise<string>` — nearest ancestor with `.git`, else `cwd`.

- [ ] Tests (synthetic): Database rule stops `psql -c "DROP TABLE users"`, `docker exec db psql -c "delete from orders"`, `TRUNCATE`, `UPDATE t SET a=1;` without WHERE; does not stop `psql -c "SELECT 1"` or `DELETE … WHERE id=1`; `rm -rf /tmp/x` stops with root `/work/app`, `rm -rf ./build` does not; `git push --force` and `-f` stop, `git push` does not; bypass hides project rules, keeps session rules; an allowed exact command passes while a different one stops; two `update` calls from two store instances keep both changes.
- [ ] Implement; commit.

### Task 3: Claude hook path

**Files:** `apps/daemon/src/code/hooks/hook-server.ts`, `hook-delivery.ts`, `install-hooks.ts`, `setup-cli.ts` (hook CLI timeout), `commands/permission-broker.ts`, `monitor/monitor.ts` (session `permissionMode` from every hook), `apps/daemon/src/rules/check.ts`; tests `tests/daemon/rules/claude-hook.test.ts`, existing hook tests.

**Interfaces:**

- `PermissionBroker.open(request, { maxWaitMs? })` — rule requests pass `RULE_ANSWER_TIMEOUT_MS`; other requests keep 45 s.
- `ruleCheck(hook, session, store): Promise<{ rule, scope } | null>` in `rules/check.ts` (shell tool = Claude `Bash`).
- Hook IPC reply gains `settled: true` when a decision was taken (allow or deny); `deliverHook` resolves on the first settled reply, else `{}` when all replied.
- PreToolUse outputs: allow → `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }`; deny → `permissionDecision: 'deny'` + reason (Global Constraints text).
- Allow always → `store.update` adds the command to the scope's `allowed`, then as allow.

- [ ] Tests: a PreToolUse `Bash` hook matching a session rule in a `bypassPermissions` session opens one permission with `rule` and `expiresAt ≈ now + 10 min`; resolving allow returns the allow output with `settled`; deny and timeout return deny with the exact reason; no match returns `{}` at once; `deliverHook` with targets answering `{}` and `{settled, output}` resolves to the settled one; installer writes PreToolUse `timeout: 660`; monitor stores `permissionMode`.
- [ ] Rule stops work without `REMOTE_PERMISSIONS_ENABLED` (that flag keeps gating the agent's own prompts only).
- [ ] Implement; commit.

### Task 4: Codex hooks

**Files:** `apps/daemon/src/code/hooks/install-codex-hooks.ts`, `setup-cli.ts` (install/uninstall), hook route in `hook-server.ts` for Codex payloads, `rules/check.ts`; tests `tests/daemon/rules/codex-hook.test.ts`.

- [ ] Probe first (temporary `CODEX_HOME`, never the owner's `~/.codex`): the PreToolUse payload of a shell call (tool name, where the command text is, `permission_mode` value under `approval_policy=never`), behaviour on hook timeout, `timeoutSec` accepted, and whether a Codex Desktop thread runs the hook. Record findings at the top of the test file.
- [ ] Installer writes the marked PreToolUse entry (timeoutSec 660) into `$CODEX_HOME/hooks.json`, keeps the owner's entries, backs up like the Claude installer.
- [ ] Codex hook frames are matched by thread id to the monitor's Codex session; outputs: allow → `{}` with `settled`, deny → `permissionDecision: 'deny'` + reason.
- [ ] Tests mirror Task 3 with Codex payloads from the probe; commit.

### Task 5: Own rule from words

**Files:** `apps/daemon/src/rules/compile.ts`; test `tests/daemon/rules/compile.test.ts`.

**Interfaces:** `compileRule(sentence: string, run: (prompt: string) => Promise<string>): Promise<{ name: string; patterns: string[] }>`; default `run` spawns `claude -p --output-format json` (no session data in the prompt; `--setting-sources project` from an empty temp cwd so no hooks fire).

- [ ] Tests with a fake `run`: valid JSON → name + patterns; patterns that do not compile as RegExp, more than 20, or an empty list → `ErrorCode.INVALID_REQUEST`; the sentence is passed as data inside the prompt, not as instructions.
- [ ] Implement; commit.

### Task 6: Rules transport

**Files:** `apps/daemon/src/rules/service.ts` (`rulesView`, `applyRuleRequest`), `runtime/relay-frame-router.ts`, `local/controller/documents.ts` (`LocalOperation.Rules`, owner only), server `sessions/device-requests.ts` (`rules(connection, request)`), `devices/devices.controller.ts` (`POST /devices/:id/rules`), device-socket accept; tests `tests/server/devices/device-rules.test.ts`, local controller test.

- [ ] Server test like `device-analytics.test.ts`: offline, protocol < 7, other owner, invalid body, answer returned.
- [ ] Local test: owner only; a toggle shows up in the next view.
- [ ] Implement; commit.

### Task 7: Telegram ❗ with answer buttons

**Files:** server `notifications/` (permission copy with rule; inline keyboard), `notifications/worker.ts` (`allowed_updates` + `callback_query`), a short-token table (migration `010_telegram_actions.sql` + Drizzle schema) mapping a 22-char token to `{ owner, device, session, requestId, generation, expiresAt }`, decision sent through the same command path as the app's permission answer; tests `tests/server/notifications/rule-permission.test.ts`.

- [ ] Tests: a rule permission event yields `❗ Claude хочет выполнить команду по правилу «…» · <title>` (en/ru) with the command in `<code>` and three callback buttons; a callback from another Telegram user is refused; a valid one dispatches the decision once and answers the callback; an expired token says so.
- [ ] Implement; commit.

### Task 8: Mini App

**Files:** `apps/mini-app/src/pages/rules/**` (page, tabs, own-rule dialog with pattern confirmation), settings menu entry, session header 🛡 badge (`entities/rules`), permission card: ❗, rule name, third button _Allow always_; clients (`relay-operations.ts`, desktop `operations.ts`, extension `operations.ts`), i18n `dictionaries/rules/`, stories, e2e `tests/e2e/shell/rules.spec.ts`, desktop bridge fake answers `LocalOperation.Rules`.

- [ ] Stories: project tab, session tab in bypass (notice), own-rule confirmation, rule permission card; light/dark; ru/en.
- [ ] e2e: settings → Rules toggles a ready rule for the project; the session tab shows it under "from project" and the bypass notice; a rule permission card shows ❗ and three buttons and sends `allow_always`.
- [ ] `npm run check:frontend`; commit.

### Task 9: Deploy and verify

- [ ] Personal and desktop rebuilt and restarted; Claude and Codex hooks reinstalled (installer), owner told that hooks were updated.
- [ ] Live check in a scratch directory: a session rule "Suspicious database queries" in a bypass Claude session stops `psql -h 127.0.0.1 -p 1 -c "DROP TABLE synthetic"` with ❗ in Telegram and the app; Deny blocks it; Allow always lets the same command through next time and still stops `TRUNCATE synthetic`. Same for Codex once Task 4's probe confirms its hooks.
