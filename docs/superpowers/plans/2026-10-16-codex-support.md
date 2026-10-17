# Codex Support Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task inline. Follow the existing user instruction to continue authorized work. Never commit.

**Goal:** Add Codex CLI and Mac application support to the existing remote-agent service.

**Architecture:** Share relay, pairing, command dispatch and capability-driven UI. Separate provider identities and use Codex App Server behind a local adapter. Prepare protocol/UI first; accept runtime support only against the actual source process.

**Tech Stack:** TypeScript, Zod, existing Node companion and WebSocket relay, Codex App Server JSON-RPC, React, i18next/react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-16-codex-support-design.md`

## Global constraints

- No commits, paid hosting or new API-key requirement; preserve existing local Codex authentication.
- Support both CLI and Mac app, explicitly confirmed by the user.
- Preserve per-user ownership, exact target identity, generation fences and durable command dedup.
- Keep legacy Claude wire fields compatible; Codex uses its own thread ID and a null Claude session ID.
- Follow frontend AGENTS.md, FSD, 200-line files, RU/EN and all required quality gates.

## Review focus

- A stored thread is not the same as the active process: runtime must not create a second writer silently.
- A request may be resolved locally before its Telegram answer arrives: reject the stale answer.
- An ambiguous write followed by a disconnect must not trigger a second model turn automatically.
- Codex and Claude may have similar identifiers: never route by title, focus or truncated ID.
- App Server command output is not an interactive terminal snapshot.

### Task 1: Provider-aware protocol and interface

**Files:** Modify `packages/protocol/src/schemas.ts`, frontend session labels/cards/detail/feed and RU/EN dictionaries. Add `tests/codex-contract.test.ts`, `tests/e2e/codex.spec.ts`, Codex fixture data and stories. Link this spec/plan from README.

**Interfaces:** Targets `codex-cli | codex-desktop` carry `{deviceId, connectorId, threadId}`. Existing sessions keep `claudeSessionId`, set to null for Codex. `sourceSessionId(session: Session): string | null` selects the correct identifier. `agentName(session: Session): "Claude" | "Codex"` supplies assistant attribution.

- [x] Write failing contract tests accepting Codex targets/commands/connectors and rejecting mixed provider IDs, empty thread IDs and owner injection.
- [x] Run `npm test -- tests/codex-contract.test.ts` and confirm RED.
- [x] Add target kinds, app-server transport and provider validation. Add exact source labels/identities, assistant attribution and neutral command copy.
- [x] Add mobile real-relay scenarios for each source: correct identity, no terminal tab, exact prompt/permission/interrupt target and RU/EN; keep owner isolation and all existing scenarios.
- [x] Run `npm test` and `npm run check:frontend`; require all checks green. Rebuild the running app's static bundle without changing its tunnel URL.

### Task 2: Local App Server transport and binding

**Files:** Create `apps/daemon/src/codex/rpc-client.ts`, `transport.ts`, `binding.ts`, `tests/codex-rpc.test.ts`, `tests/codex-binding.test.ts`. Modify authenticated local IPC wiring in `code/hook-server.ts`, `main.ts`, `setup-cli.ts`.

**Interfaces:** `CodexRpcClient.request(method: string, params: unknown): Promise<unknown>`, `respond(id: string | number, result: unknown): void`, `close(): Promise<void>`; notifications and server requests are separate events. `bindCodex({kind, threadId, socketPath}, dependencies)` returns a registered source/session bound to that exact local process.

- [x] Test bounded JSONL parsing, out-of-order RPC IDs, initialization once, malformed/oversized frames, unknown response IDs, timeout after write and child exit. Responses after write loss produce an uncertain outcome; reads may fail safely.
- [x] Implement direct Unix WebSocket access to an explicitly selected, locally verified Unix socket (the installed stdio proxy failed its native probe); no shell interpolation or public unauthenticated listener. Bound pending requests and message size; cancel all timers on close.
- [x] Test thread mismatch, active local turn and reconnect generation. Load metadata/history without creating a new conversation. Require an explicit managed-session mode if attachment is unavailable; do not silently resume a second writer.
- [x] Expose local `remote codex bind cli|desktop <thread-id> --socket <absolute-path>` through authenticated IPC. Never let relay/browser supply a process path or socket.
- [x] Run RPC/binding tests, full `npm test`, typecheck and build. Record local compatibility diagnostics without reading unrelated chats or credentials.

### Task 3: Events, commands and permissions

**Files:** Create `apps/daemon/src/codex/binding.ts`, `events.ts`, `approvals.ts`, `tests/codex-binding.test.ts`, `tests/codex-desktop-client.test.ts`. Use existing registry, monitor, dispatcher and permission broker.

**Interfaces:** Adapter implements existing `SessionAdapter`; event conversion returns existing `HistoryMessage`/status envelopes; approval bridge opens existing `PendingPermission` records and answers their original RPC IDs.

- [x] Test prompt maps to the exact thread, interrupt to its exact active turn, simultaneous Claude/Codex sessions remain separate, duplicate relay commands produce one turn, and disconnect after write never retries automatically.
- [x] Map thread/turn/item events to session status/history; deduplicate items and reset active turn on completion. Advertise no terminal screenshot for App Server.
- [x] Test one-time allow/deny for execution and file changes; reject stale generation, locally resolved request, expired request, changed turn and cross-owner response. Allow maps to `accept`, never `acceptForSession` or an exec-policy amendment. Unsupported request shapes remain disabled.
- [x] Cancel pending decisions on resolution, disconnect, revoke and completion. Keep prompt/permission feature flags enforced by both relay and companion.
- [x] Run full automated checks, then verify a synthetic thread against installed CLI and Mac app separately. Record exact observed capabilities/version; do not upgrade unverified capabilities to ready.

### Task 4: Runtime delivery

**Files:** Update `docs/install-daemon.md`, `docs/acceptance.md`, `README.md`; add a synthetic compatibility probe under `scripts/` and its report under ignored `artifacts/`.

- [x] Document verified attach vs managed-resume behavior and source-specific setup, including unavailable transport/version states.
- [x] Exercise original local turn, remote prompt/answer, interrupt and one-time command approval against installed CLI and Mac app in a dedicated synthetic thread. Exercise both file/command allow/deny, reconnect, stale/cross-owner decisions and revoke through controlled daemon/relay/browser E2E. Physical Telegram and a second real Mac remain separate acceptance boundaries.
- [x] Run `npm test`, `npm run check:frontend` and appropriate companion packaging verification after runtime changes. List remaining unsupported behavior explicitly.

## Delivery evidence — 2026-10-17

280 unit/integration tests, 61 Storybook checks and 71 browser E2E scenarios; native CLI0.149.0 and desktop0.162.0-alpha.17.2 answers, original context, interrupt and one-time command approval verified separately. See docs/acceptance.md and docs/e2e-coverage.md. Source/model permissions and arbitrary structured input remain explicit capability boundaries. One fresh backend review produced three important regressions, each reproduced and fixed. Subsequent deterministic regressions cover disabled local permissions, unknown source state, equal-time history order and the Desktop500-item publication window. No commits or paid services.
