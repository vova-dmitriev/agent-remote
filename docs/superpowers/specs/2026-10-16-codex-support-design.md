# Codex support

## Intent and delivery boundary

Support Codex alongside Claude in the same Telegram Mini App, personal Mac launcher and multi-user relay. Support both native CLI and the Mac application, explicitly confirmed by the user. Keep the existing no-paid-hosting deployment and RU/EN interface.

The initial preparation phase delivered provider-aware protocol/UI. The subsequent explicitly authorized implementation delivers runtime connectors for CLI and the Mac application, with installed-source compatibility evidence and controlled full-stack E2E. Live probes use only newly created disposable threads. Physical Telegram and unrelated Claude Desktop acceptance remain separate boundaries.

## Architecture

Extend the current adapter registry rather than creating a second bot or relay. Use distinct `codex-cli` and `codex-desktop` targets containing `deviceId`, `connectorId` and `threadId`. Codex sessions must have `claudeSessionId: null`; keep the legacy Claude field for wire compatibility. Titles derive from the source's real identity, never a fabricated Claude identifier. Add `app-server` as a connector transport.

Codex runtime uses its local App Server JSON-RPC protocol. Prefer a connection to the process that owns the thread; a second process resuming a stored thread is not proof of control over the original CLI or app. The installed CLI exposes `codex app-server proxy --sock <absolute-path>` for stdio access to an existing local control socket. Discover and verify compatibility locally before enabling a connector; do not assume all versions expose this transport.

The implementation uses Unix WebSocket directly with compression disabled: the installed proxy hung during the local probe. The Mac application exposes a private versioned follower IPC; exact owner discovery plus a recognized state snapshot establish its binding. The alternative for CLI sessions without a compatible control socket is an explicitly managed App Server session. It preserves the selected thread through explicit resume after closing its old frontend. Do not silently start two writers for one thread. Accessibility automation is not the primary integration.

## Operations

- Read history through `thread/turns/list` and `thread/items/list`; prefer completed items for durable history and deduplicate by thread/turn/item identity.
- Send prompts with `turn/start`; interrupt the exact active `turnId` with `turn/interrupt`. Keep generation leases, ownership checks, command dedup and uncertain-result handling.
- Route command/file-change approval requests through the existing one-time permission broker, scoped to thread, turn, request and connection generation. An allow grants only the requested operation, never a session-wide policy amendment. Unsupported structured input stays unavailable until it has a matching UI.
- Treat local resolution, timeout, connection loss, turn completion and device revoke as invalidation events. A stale Telegram decision must never answer a later request.
- Stream tool output as events, not a fabricated terminal screenshot. Advertise `terminalSnapshot: false` for App Server connections.

## UI

Show Codex CLI and Mac app as separate sources alongside existing Claude sources. Use the Codex thread identity in cards and details, and label assistant messages with the correct agent. General UI copy and command receipts must work for either agent. Source-specific features remain capability-driven. Synthetic Storybook and relay fixtures are not compatibility claims.

## Acceptance

The preparation phase must pass protocol validation, provider identity rejection, real-relay mobile command routing for both Codex target kinds, RU/EN switching, existing owner-isolation tests and all frontend gates. No Codex process is spawned just by adding target support.

Runtime acceptance additionally requires an actual installed Codex connection and a synthetic thread: observe an original local turn, deliver exactly one Telegram prompt to that same thread, observe its answer, interrupt the correct turn, resolve one permission once, reject stale/cross-owner decisions, and reconnect without duplicated turns. Record the CLI/app version and supported transport; leave capabilities disabled where this is unverified.

## Sources

- [Official OpenAI App Server protocol](https://learn.chatgpt.com/docs/app-server): lifecycle, transports, thread/turn methods and approval requests, checked 2026-10-16.
- Installed `codex app-server --help` and `codex app-server proxy --help`, checked 2026-10-16. No private sessions, credentials or user message contents were inspected.
