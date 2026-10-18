# Desktop Shared UI Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for explicitly approved implementation; use superpowers:subagent-driven-development only if explicitly selected. The user subsequently authorized implementation on 2026-10-18. Do not commit, deploy or change live sessions during fixture-based implementation.

**Goal:** Deliver a macOS desktop application that reuses the existing React UI and controls the same companion locally, with optional Telegram remote access.

**Architecture:** One FSD frontend with Telegram and desktop host/client adapters. A sandboxed Electron renderer uses a narrow preload bridge; the privileged host connects to an independently running standalone Node companion. The companion owns execution, persistence and optional relay synchronization.

**Tech stack:** Existing React/Vite/Zustand/TanStack Query, TypeScript/Zod, Node companion, SQLite and Swift helper; Electron is the recommended shell, with a documented Tauri 2 alternative. Shell dependencies must be pinned when implementing the approved Electron host.

**Spec:** [Desktop shared UI design](../specs/2026-10-17-desktop-shared-ui-design.md).

## Execution status — 2026-10-18

Shared host/client boundaries, local companion authority and supervision foundations are implemented through the Chrome work. The Electron shell, desktop lifecycle/settings UI and signed distribution remain pending. Reuse these existing foundations rather than implementing a second runtime or copying the React pages. Desktop work must consume profile and continuity capabilities only after their acceptance.

## Global constraints

- Planning assumptions: macOS first and autonomous local mode without Telegram, relay, PostgreSQL, Redis or Docker. Keep these assumptions visible until the user confirms them; remote-only scope changes Tasks 2–5.
- Reuse `apps/mini-app/src` directly with separate entrypoints/build targets. Do not copy pages/components or move the entire UI tree to another package as a prerequisite.
- Keep FSD, dedicated props/types, named domain constant objects, RU/EN copy, static test IDs, 200-line source/test/config files and six-file slice directories. Stories perform interactions only.
- Credentials/provider profiles/daemon tokens stay outside renderer state and IPC responses. Every action is schema-validated and fenced by owner/device/session generation/client epoch; no arbitrary shell, URL request or filesystem API.
- Preserve existing Telegram behavior and ongoing subscription-switching work. Desktop reuses its profile/continuity engine only when those capabilities are actually implemented and accepted. No live account prompts/sign-ins, production restarts, user-process termination, commits or publishing are authorized by this planning request.

## Review focus

- A GUI launch has no development Node/PATH, or an Electron executable is embedded in a CLI/hook command: Tasks 1 and 3 test explicit signed runtime/resource resolution and clean installation.
- Renderer injection, iframe navigation or a forged media request crosses into native privileges: Tasks 1 and 4 test narrow schemas, sender/epoch checks and opaque attachment access.
- Window close, duplicate startup, application update or relay outage kills/restarts a user's native session: Tasks 2–3 and 6 test independent daemon ownership and lifecycle.
- Reusing Telegram authentication assumptions or merging local/remote owner namespaces grants the wrong user access: Tasks 2 and 5 test local identity, explicit pairing/import grants and separate authority scopes.
- Shared-UI extraction regresses reading positions, uploads, queue receipts or answers across hosts: Tasks 1, 4–6 run the same synthetic behavioral scenarios and bounded-history assertions.

## Delivery order

A. Shared host/client interface without a new shell (Task 1).
B. Independently testable local runtime and packaging/supervisor (Tasks 2–3).
C. Secure Electron host and shared desktop UI (Tasks 4–5).
D. Native acceptance and signed distribution (Task 6). Tauri remains an alternative implementation of the same boundaries, not a second simultaneous product.

### Task 1: Shared frontend host and application-client contracts

**Files:** create `apps/mini-app/src/shared/lib/host/{types,context,use-host,telegram-host,index}.ts`, `shared/api/application-client.ts`, `packages/protocol/src/values/host.ts`; update `shared/api/{transport,index,preferences}.ts`, runtime types/context, `entities/session/model/use-session-connection.ts`, `app/app.tsx`, rename/pair/revoke consumers and their types. Test: `tests/application-client-contract.test.ts`, `tests/host-runtime-lifecycle.test.ts`, existing auth/runtime browser tests.

**Interfaces:** `HostAdapter.createClient(handlers: TransportHandlers): ApplicationClient`; `HostAdapter.capabilities: HostCapabilities`; `ApplicationClient` preserves start/close/logout, device selection, history/paging, send/check/retry and `AttachmentAccess`, and adds explicit `getPreferences`, `savePreferences`, `renameSession`, `claimDevice`, `revokeDevice` and bookmark operations. Define `HostKind`, `HostCapability` and host error values in named objects. Only the Telegram implementation owns its internal generic HTTP request method.

- [ ] Write RED cases for injected host selection, missing Telegram only expiring Telegram mode, stale runtime leases after logout/reconnect and identical command/history/attachment behavior through a controlled client. Assert requests and resulting state rather than class names or source text.
- [ ] Introduce typed interfaces and Telegram adapter, replacing concrete `AppTransport` dependencies in shared runtime and feature controllers. Preserve existing authentication/refresh behavior and command reconciliation; do not expose a privileged desktop implementation yet.
- [ ] Add synthetic Storybook host fixtures for Telegram, disconnected desktop and desktop-capability-unavailable states without copying pages. Keep all assertions in tests and all interaction IDs static.
- [ ] Run targeted unit/runtime E2E to GREEN, `npm run typecheck`, `npm run build`, `npm run test-storybook` and `E2E_APP_PORT=4175 npm run test:e2e`. Deliverable: current Mini App behavior remains accepted behind a reusable client port.

### Task 2: Local companion controller and durable local authority

**Files:** extract composition from `apps/daemon/src/main.ts` into `runtime/{types,controller,lifecycle,relay-adapter}.ts`; create `local-control/{types,server,auth,dispatch,subscriptions}.ts`, `local-store/{types,repository,migrations}.ts`, protocol `local-control.ts`, and `values/local-control.ts`. Reuse monitor/native readers, command stores/brokers and dispatcher. Test: `tests/local-companion.test.ts`, `local-control-ownership.test.ts`, `local-state-recovery.test.ts`.

**Interfaces:** `startLocalRuntime(options: LocalRuntimeOptions): Promise<LocalRuntime>`; `attachRelay(runtime, grant: RemoteOwnerGrant): Promise<RelayAttachment>`; `serveLocalClient(runtime, options: LocalControlOptions): Promise<LocalControlServer>`. `LocalRuntime` exposes schema-bounded client operations and a deliberate stop lifecycle. `LocalPrincipal`, `RemoteOwnerGrant` and `LocalClientLease` identify distinct local/remote scopes; the renderer cannot supply its own trusted principal.

- [ ] Write RED tests for startup without pairing config/network/SQL services, persisted local identity/preferences/bookmarks/receipts, bounded history reads, wrong UID/file/socket ownership, invalid capability, stale epoch, command replay and incompatible protocol version. Use disposable roots/native peers only.
- [ ] Extract the headless runtime while retaining the existing relay-mode entrypoint. Add local persistence and versioned migrations without rewriting existing device configuration, hooks, IDs or credential files. No background task reads a whole large transcript to open a chat.
- [ ] Add an owner-only local-client endpoint with a capability separate from the hook/wrapper secret, strict frame limits, per-client revocation and the same command/permission/question authorities. Local and relay commands share one dedup journal and source generation checks.
- [ ] Implement an explicit approved local↔remote scope binding/import operation. Local-only records stay local until shared. Profile/preferences policy repositories use the appropriate authority scope; when paired, journal/version checks serialize local and remote mutations and expose conflicts instead of overwriting another owner's state. Reuse profile logic rather than a desktop-specific account registry.
- [ ] Run all three tests to GREEN, including relay loss while local work continues, concurrent local/remote answers, migration/recovery and two-owner denial. Deliverable: reusable local runtime with no Electron/Tauri dependency.

### Task 3: Packaged standalone Node runtime and companion supervision

**Files:** create `apps/desktop/package.json`, `runtime/{types,manifest,paths,supervisor,discovery}.ts`, `scripts/desktop/{package-runtime,verify-runtime}.mjs`; update daemon runtime path injection, CLI install/launch helpers and `scripts/package-daemon.ts` as needed. Test: `tests/desktop-runtime-paths.test.ts`, `desktop-companion-lifecycle.test.ts`, `desktop-native-artifact.test.ts`.

**Interfaces:** `resolveDesktopRuntime(resourcesPath): Promise<DesktopRuntimeManifest>`; `connectOrStartCompanion(options: DesktopCompanionOptions): Promise<CompanionConnection>`. The manifest binds exact resource paths, OS/architecture, Node version/module ABI, daemon protocol and helper version. Native executable paths come from verified host resources/configuration, never renderer arguments or guessed `process.execPath`.

- [ ] Write RED cases for paths with spaces, missing/global Node, wrong architecture/ABI, tampered resources, symlink escape, second-instance startup, incompatible existing daemon and app relocation. Prove native PTY/SQLite/helper operations in a packaged disposable runtime.
- [ ] Pin compatible maintained Node/shell tooling, record the runtime manifest and package ABI-matching daemon dependencies plus the Swift helper. Keep native resources outside renderer bundles/ASAR. Do not rebuild the existing CLI installation's node modules against Electron.
- [ ] Implement authenticated attach-before-start, race-safe discovery and an independently running owned companion. Close/reopen and normal UI quit retain sessions; explicit stop affects only a verified owned daemon and warns about managed PTYs. Do not stop unmanaged processes or replace a user's running companion on a version mismatch.
- [ ] Resolve stable launcher/hook resource locations and a maintenance-boundary update strategy. Preserve executable modes, cmux/project environment and noninteractive executable discovery. Do not put a DMG mount or application temporary directory into persistent hooks.
- [ ] Run all three tests to GREEN. Record measured packaged size/start time/native health in a compatibility note; measurements, not framework marketing, decide whether a Tauri substitution is worth its additional host work.

### Task 4: Secure Electron host, preload and media bridge

**Files:** create `apps/desktop/src/main/{bootstrap,window,protocol,ipc,links}.ts`, `preload/{bridge,types}.ts`, `client/{types,companion,media}.ts`; protocol `desktop-bridge.ts`; frontend `shared/lib/host/desktop-host.ts` and `shared/api/desktop-client.ts`. Add appropriate public APIs and named props/types when files split. Test: `tests/desktop-ipc-security.test.ts`, `desktop-media-bridge.test.ts`, `desktop-client-contract.test.ts`.

**Interfaces:** `DesktopBridge` exposes only typed application methods, event subscription/unsubscribe, and upload/download lifecycle operations. `createDesktopClient(bridge, handlers): ApplicationClient` implements Task 1's interface. Native paths, credentials, raw socket handles, arbitrary IPC channel names and arbitrary request URLs are not bridge inputs or outputs.

- [ ] Write RED tests for an untrusted window/subframe/origin, stale lease, revoked client, oversized payload, unknown action, path traversal, forged attachment ID, unsafe external URL and unsubscribed events. Replay the application-client contract against the real bridge dispatcher with controlled companion I/O.
- [ ] Implement sandboxed/context-isolated windows with Node integration disabled, bundled preload, custom trusted asset origin and restrictive CSP. Block unsolicited navigation/new windows and validate every privileged sender/action. Development-server exceptions must not enter production configuration.
- [ ] Implement typed companion routing, bounded ordered events and backpressure. Adapt browser File/Blob/abort/progress to chunked attachment operations with a maximum 256 KiB IPC chunk and the existing total attachment budgets. Validate session ownership/generation before bytes are read or written; cancel cleanup removes temporary uploads.
- [ ] Serve previews/downloads by opaque authorized IDs and reuse the fullscreen viewer/object-URL cleanup. Renderer exceptions and bridge errors contain central error codes, never tokens, file contents or private absolute paths. No remote HTML/Telegram script is loaded in the desktop renderer.
- [ ] Run all three tests to GREEN. Keep macOS permission/Keychain/native-connector behavior separate from success of a renderer mock.

### Task 5: Shared desktop entry, local UX and optional Telegram attachment

**Files:** create `apps/mini-app/desktop.html`, `src/desktop.tsx`, `vite.desktop.config.ts`; add Electron main/preload build configs and Forge packaging config in `apps/desktop`; extend shared application composition, host capability-aware shell controls and synthetic stories. Create desktop settings/model modules for tray, window state and remote attachment. Test: `tests/desktop-entry.test.ts`, `tests/desktop-e2e/shared-ui.spec.ts`, `local-offline.spec.ts`, `remote-attachment.spec.ts`.

**Interfaces:** desktop bootstrap injects Task 4's host into the same `App`/`RemoteApplication` tree. `DesktopSettingsService` persists safe window/tray/locale preferences; `RemoteAttachmentController` wraps Task 2's approved owner/device-grant flow. Local disconnect closes that viewer lease, not provider login, daemon or native session. Host capabilities determine which pairing/access actions are available.

- [ ] Write RED desktop scenarios without `window.Telegram`, a relay, Docker or a development Node: sessions open, Enter sends, queued prompts edit/send according to existing rules, answers/approvals reconcile, scroll position and active marker restore, images zoom, diffs highlight and subagent state updates. Use synthetic sessions/static test IDs only.
- [ ] Build the existing UI source through a dedicated desktop entry with relative resource paths and no Telegram script. Preserve the web build output and Storybook aliases; do not duplicate pages, stores or profile forms. Desktop-specific layout/shortcuts stay in the host shell and retain accessible keyboard behavior.
- [ ] Add single-instance focus, window state, tray/close behavior, local connectivity/remote-access status and explicit remote pairing/disconnect controls. Never equate loss of relay connectivity with loss of the local companion, or provider sign-out with closing a viewer.
- [ ] Exercise local-only installation and optional reuse/import of existing paired configuration. Add sharing only through approved scope binding; rejection/revoke/offline mismatch must preserve existing local sessions and credentials. Keep future Accounts & keys/switching features gated by the shared profile engine's actual capabilities.
- [ ] Run new native Electron scenarios through Playwright's Electron API and the unchanged mobile E2E/Storybook suites to GREEN. Verify packaged assets, not only Vite development mode. Record any limitation of the pinned Forge Vite plugin, which official docs currently label experimental.

### Task 6: Native acceptance, signing and distribution

**Files:** create desktop packaging verification scripts/configuration and `docs/desktop.md`; extend root validation/CI for desktop code, architecture/type boundaries and native artifacts; add `tests/desktop-e2e/packaged-runtime.spec.ts`. Define root `test:desktop`, `package:desktop` and `verify:desktop` commands only at implementation time, with no publish step.

- [ ] Write artifact checks rejecting embedded credentials, actual sessions, dev-server URLs, unrestricted IPC, test-only automation bridges and broken executable/resource signatures. Run native PTY, SQLite, helper and application-client checks from the unpacked package with a temporary user-data directory.
- [ ] Verify a clean Mac install with no global Node/Docker, Accessibility permission denied/granted, Finder launch/PATH, application move, duplicate launch, crash/reopen, active session on window close, optional relay outage and a compatible companion already running. Distinguish packaged native acceptance from Storybook/browser evidence.
- [ ] Run `npm run validate`, `npm run test-storybook`, `E2E_APP_PORT=4175 npm run test:e2e`, new `npm run test:desktop`, `npm run package:desktop` and `npm run verify:desktop`; inspect outputs and obtain independent review. Extend strict validation/CI to cover the new desktop source/configs without making Linux jobs pretend to test macOS-native behavior.
- [ ] Produce an ad-hoc internal artifact first. Public release requires Developer ID signing/notarization of the app and nested Node/helper/native resources, clean-install verification and separate authorization to publish. Do not disable library validation or add broad entitlements to hide signing failures. Keep optional login items and updates opt-in; use signed updates only at an explicit maintenance boundary.
- [ ] Document English agent startup/build instructions and English synthetic desktop/Storybook screenshots. Preserve the current public Mini App URL, bot configuration and live sessions; desktop release does not require changing them.

## Tauri substitution map

Tasks 1–2 and the Node runtime/manifest from Task 3 stay shared. Replace Electron `apps/desktop` host/preload code with a Tauri Rust backend, exact command/capability schemas and fixed backend-owned sidecar startup. The renderer still implements the same `HostAdapter`/`ApplicationClient` interface and loads the same desktop HTML entry; no agent logic moves to Rust.

Add target-triple sidecar packaging and actual system-WebView parity checks. Current official Tauri docs offer an embedded WebDriver service for macOS; native `tauri-driver` alone does not cover macOS. Prove the selected approach and remove test-only plugins from release artifacts. Measure the complete signed bundle including Node, native addons and helper before changing the framework decision. Selecting Tauri requires revising shell-specific Tasks 3–6 before implementation, not building both alternatives speculatively.

## Planning result

Recommended order: finish the shared profile/runtime foundations already in progress, then implement the shared host/client port, local controller and desktop shell. The desktop plan can reuse those interfaces without blocking the current subscription-switching work. Only documentation is produced by this request; no new framework, desktop code, credentials or live configuration is installed or changed.
