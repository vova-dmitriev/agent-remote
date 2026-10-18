# Chrome Extension Shared UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for approved implementation; use superpowers:subagent-driven-development only if explicitly selected. Implementation was subsequently authorized by the user, including strict validation and E2E coverage. Personal browser installation, commits and publication remain separate actions.

**Goal:** Deliver a Chrome side panel and full extension tab using the existing React application and the same local companion.

**Architecture:** The shared `HostAdapter`/`ApplicationClient` boundaries serve Telegram, desktop and extension builds. A thin MV3 service worker brokers typed requests to an installed Native Messaging bridge; an independent companion owns execution, authority, durable state and account profiles.

**Tech Stack:** Existing React/Vite/Zustand/TanStack Query, TypeScript/Zod, Chrome MV3/Native Messaging, existing Node companion/SQLite and Playwright Chromium. No new framework is needed for planning; pin Chrome types/build dependencies during implementation.

**Spec:** [Chrome extension shared UI design](../specs/2026-10-17-chrome-extension-shared-ui-design.md).

## Execution status

The internal macOS implementation now includes the shared host/client boundary, independently supervised companion, scoped Native Messaging authority, bounded media/history transport and durable draft/queue/reading state. The existing Telegram UI remains the single React implementation. See [internal build and installation workflow](../../chrome-extension.md).

Tasks 1–4 are implemented and covered by unit/integration and isolated Chromium E2E checks. Task 5 remains open for branded Chrome toolbar/side-panel acceptance, signed/notarized companion installation on a clean macOS account, browser update/restart acceptance and cross-surface attachment recovery described in the workflow. An internal artifact is not a public release. Account credential management, automatic subscription fallback and desktop packaging remain separate plans.

The checklists below retain the original acceptance requirements; this status records implementation without claiming unperformed release acceptance.

## Global constraints

- Planning assumptions: desktop Chrome, macOS first, local companion first. Desktop window is optional. Remote relay viewer authentication needs a separate reviewed plan.
- One FSD implementation in `apps/mini-app/src`, separate entrypoints/build targets. Shared host/client and local runtime foundations from desktop Tasks 1–3 are prerequisites, not existing completed features.
- Preserve named domain constants/derived types, dedicated props/types, RU/EN dictionaries, static test IDs, 200-line source/test/config files and six-file slice directories. Storybook interactions contain no assertions; public screenshots use English synthetic fixtures.
- MV3, minimum Chrome API version 116, permissions exactly `sidePanel`, `nativeMessaging`, `storage`; no content scripts, external messaging, remote code, incognito, browsing access or host permissions in local MVP.
- Every path validates schemas, grants/owner/device scope, generation and epoch. Native JSON frames are at most 512 KiB encoded; logical messages at most 8 MiB with 16 MiB aggregate reassembly per bridge and 30-second fragment expiry. Media chunks are at most 256 KiB raw with one acknowledged chunk per transfer; attachments keep protocol limits of 10 MiB/file, five files and 20 MiB/message. Do not change live configuration or subscription-switching work.

## Review focus

- Extension bootstrap inherits Telegram initData/cookie/remote-script assumptions: Tasks 1 and 4 prove independent bundled startup and unchanged Telegram behavior.
- Service-worker termination, a lost receipt or two viewers causes duplicate delivery or queue edits: Tasks 2–4 prove companion authority, stable IDs, revision fences and reconciliation without replay.
- Browser/extension ID, native registration path or local grant is mistaken for an owner login: Task 2 proves exact origins, distinct owner scopes, explicit approval, revoke and version failure.
- Unicode JSON, base64 or large history exceeds framing budgets and freezes the panel: Task 3 proves byte limits, fragmentation, backpressure and cancellation against real streams.
- Reopen/tab switching restores the wrong locale, filter, bookmark, active marker or draft: Task 4 proves persisted shared state, separate viewer leases and concurrent-bookmark revision handling.

## Dependency and file map

Implement [desktop Task 1](2026-10-17-desktop-shared-ui.md) once for the shared host/client contract, then desktop Tasks 2–3 for local authority and standalone Node supervision. Chrome requires these foundations but does not require Electron/Tauri Tasks 4–6. If already delivered, consume their public APIs instead of creating parallel implementations.

Keep extension-only code in `apps/chrome-extension/src/{background,client,config}` with explicit public APIs. Put stdio framing/bridge in `apps/daemon/src/browser/{transport,host,registration}`; privileged logic remains in the shared local controller. Each directory stays within repository file-count limits. UI bootstrap and Vite target stay beside the existing frontend. Tests use isolated state and browser roots; install paths and generated manifests are runtime artifacts, not machine-specific checked-in files.

### Task 1: Extension entry and shared client contract

**Files:** create `apps/mini-app/extension.html`, `apps/mini-app/src/extension.tsx`, `apps/mini-app/vite.extension.config.ts`, `apps/chrome-extension/src/config/{manifest,values}.ts`, `src/client/{host,client,types,index}.ts`. Extend shared host values/contract from desktop Task 1, shared app injection and frontend quality/build entrypoints. Test: `tests/extension-host.test.ts`, `tests/extension-build.test.ts`, existing `tests/application-client-contract.test.ts`.

**Interfaces:** `createChromeHost(connection: ExtensionConnection): HostAdapter`; `ExtensionApplicationClient implements ApplicationClient`. `ExtensionConnection.request(request: LocalClientRequest, signal?: AbortSignal): Promise<LocalClientResponse>` and `subscribe(listener: (event: LocalClientEvent) => void): () => void` adapt the local-client schemas from the shared foundation, never generic URLs. Define connection lifecycle methods `start(): Promise<void>` and `close(): void`. Centralize `ExtensionSurface` and bridge/client states in named constant objects and derived types.

- [ ] Write failing tests: `starts_without_Telegram`, `matches_shared_client_contract`, `rejects_stale_client_epoch`, `build_has_only_local_assets_and_minimum_permissions`. Assert public requests/state and built manifest/HTML, not implementation source text.
- [ ] Run `npx vitest run tests/extension-host.test.ts tests/extension-build.test.ts tests/application-client-contract.test.ts`; confirm missing entry/adapter fails before implementation.
- [ ] Implement the separate bootstrap/build with relative asset paths and injected Chrome host; keep the same App/providers/pages/stores. Emit `dist/chrome-extension` without overwriting `dist/mini-app`. Build a bundled module service-worker entry; omit Telegram SDK, popup, content scripts, remote assets and broad permissions.
- [ ] Add strict build checks for manifest floor/permissions, CSP, JavaScript asset references and absent development/test bridges. Register new source/config/test paths with existing lint, structure, types and unused-code gates; no unvalidated sibling application.
- [ ] Run targeted tests to GREEN, `npm run typecheck` and `npm run build`. Deliverable: synthetic extension UI loads through the shared contract, with no claim of native session connectivity yet.

### Task 2: Native bridge authority and companion registration

**Files:** create `apps/daemon/src/browser/host/{main,handshake,grant,index}.ts`, `browser/registration/{manifest,paths,install,index}.ts`; extend companion package/supervisor, `apps/daemon/bin/remote.mjs` and local grant store from desktop Tasks 2–3. Create `apps/chrome-extension/src/config/native-host.ts`. Test: `tests/native-host-grant.test.ts`, `tests/native-host-registration.test.ts`, `tests/native-host-lifecycle.test.ts`.

**Interfaces:** `runNativeHost(io: NativeHostIo, dependencies: NativeHostDependencies): Promise<void>`; `approveExtensionClient(request: ExtensionGrantRequest): Promise<ExtensionClientGrant>` belongs to the trusted companion controller. `registerNativeHost(options: NativeHostRegistration): Promise<void>` writes the current user's product-owned manifest. Public grant responses contain only an opaque revocable handle and safe scope metadata; existing credentials are never enumerable.

- [ ] Write RED cases: wrong caller origin/ID, unapproved/revoked handle, two owners, protocol mismatch, missing host, duplicate companion attach, unknown delivery receipt and closed browser port while a synthetic agent remains running. A denied grant must not expose session metadata.
- [ ] Run `npx vitest run tests/native-host-grant.test.ts tests/native-host-registration.test.ts tests/native-host-lifecycle.test.ts`; confirm failures before implementing the bridge.
- [ ] Implement `com.agent_remote.companion` as a minimal stdio-to-local-client bridge. Reuse shared supervisor, private endpoint and dispatcher, independent of desktop window lifecycle. Require local approval in trusted desktop settings or an explicit `remote browser authorize` command selecting the pending request/exact extension ID before creating a persisted scoped grant. The extension cannot approve itself; do not equate allowed origin with authority or merge relay/local owner scopes.
- [ ] Add an explicitly invoked native-host registration/install path using trusted packaged Node/entrypoint paths and exact dev/release origins. Cover Chrome/Chromium/Chrome for Testing registration directories, application move, no global Node/PATH, executable ownership/permissions and safe product-only uninstall. A port closing stops its bridge, never the companion or sessions.
- [ ] Run targeted tests to GREEN and existing local-controller/command reconciliation tests. Deliverable: approved synthetic client attaches to one companion with isolated grants and no renderer credential exposure.

### Task 3: Disposable worker, bounded framing and media

**Files:** create `apps/chrome-extension/src/background/{main,broker,ports,reconnect,index}.ts`, `src/client/{connection,attachments}.ts`; create `apps/daemon/src/browser/transport/{framing,fragments,media,types,limits,index}.ts`; extend shared local-client codecs/budgets without importing Chrome APIs into shared UI. Test: `tests/native-message-framing.test.ts`, `tests/extension-broker.test.ts`, `tests/extension-attachments.test.ts`.

**Interfaces:** `createExtensionConnection(runtime: ExtensionRuntime): ExtensionConnection`; `NativeFrameCodec.push(bytes: Uint8Array): NativeEnvelope[]` and `encode(frame: NativeEnvelope): Uint8Array`; codec states/operations are dedicated constants. `ExtensionAttachmentAccess implements AttachmentAccess` wraps typed begin/chunk/ack/finish/abort operations and authorized download IDs. Named codec limits enforce 8 MiB logical messages, 16 MiB aggregate pending reassembly and 30-second fragment expiry before allocation; smaller paged batches preserve complete messages.

- [ ] Write RED stream tests for split/coalesced length prefixes, malformed/truncated JSON, Unicode byte lengths, exact 512 KiB boundary, oversized declarations, out-of-order fragments, missing acknowledgments, partial-file disconnect, upload cancellation and all protocol attachment limits. Include a supported logical history message larger than one frame and a rejected over-budget reassembly.
- [ ] Run `npx vitest run tests/native-message-framing.test.ts tests/extension-broker.test.ts tests/extension-attachments.test.ts`; confirm failures with real controlled streams, not only Chrome mocks.
- [ ] Implement bounded UTF-8 framing/fragmentation and staged media with acknowledgement/backpressure, transfer expiry and redacted stderr diagnostics. No raw buffer/blob or unbounded JSON crosses Chrome messaging. History pages/events split by encoded size, preserving complete logical messages and existing bounded-history semantics.
- [ ] Broker only approved top-level extension pages, validating sender ID/origin/path, lease and request schemas. Multiplex viewer ports separately; reconnect with bounded backoff only while viewers exist. Reconcile stable command IDs after worker restart/connection loss without replay. Release the native bridge when the last viewer disconnects; do not use timers to keep the worker alive.
- [ ] Run tests to GREEN, replay the shared client contract through the actual broker/stdio bridge and inspect upload memory/cleanup under cancellation. Deliverable: commands, bounded events/history and media survive connection churn without duplicate writes or leaked partial transfers.

### Task 4: Side panel, tab and persistent shared behavior

**Files:** extend extension background action handling, Chrome host/client and shared host-capability UI; create `apps/chrome-extension/src/client/{preferences,viewer-state}.ts` if needed, splitting into a model directory before exceeding file-count limits. Extend companion reading/draft/queue modules rather than a Chrome-specific engine. Test: `tests/extension-viewer-state.test.ts`, `tests/extension-e2e/{fixtures,shared-ui.spec,lifecycle.spec,queue.spec}.ts`; add synthetic shared stories.

**Interfaces:** toolbar action configures `openPanelOnActionClick`; a localized UI action opens the extension entry in a full tab. `ExtensionViewerState` identifies a viewer lease and safe bootstrap settings. Companion-backed `DraftService` and `QueueIntentService` expose revisioned saves/edits/send-now operations through `ApplicationClient`; if these interfaces do not exist, add them once for every host before claiming persistence. `chrome.storage.local` holds only trusted-context bootstrap preferences and opaque grant handle.

- [ ] Write RED browser cases for panel/tab open, no Telegram global, locale before first paint, All/Claude/Codex filter persistence, exact middle-message bookmark/active marker restore, bottom marker after new events, Enter/Shift+Enter/IME, questions/approvals, queue edit/send-now, pending draft files and unknown receipt. Assert two-viewer edits use revisions and one viewer's selection cannot redirect another's response.
- [ ] Implement global side-panel launch and full-tab affordance with the same App tree. Persist safe bootstrap data before rendering; use shared companion reading/draft state with revision fences and scroll/navigation flushing. Disable incognito and restrict storage access to trusted contexts. Do not cache transcripts or credentials in Chrome sync/local storage.
- [ ] Make composer/outbox durability explicit: close/reopen and worker restart retain acknowledged queued intent IDs/revisions and staged attachment references. Reconcile pending send-now after disconnect; unsent edits cannot rewrite an already dispatched command. Add missing shared companion behavior rather than falsely marking an in-memory queue durable.
- [ ] Show distinct localized install-companion, grant-denied, version-mismatch and reconnect states. Keep future account/fallback controls capability-gated; connect existing image zoom/reset, diff highlighting, subagent activity and attachment download without copying components. Stories use English synthetic fixtures and interaction-only play functions.
- [ ] Run new `npm run test:extension` against built MV3 assets in Playwright bundled Chromium with an isolated persistent context. Run unchanged `npm run test-storybook` and `E2E_APP_PORT=4175 npm run test:e2e`; inspect side-panel/tab narrow/wide layouts and keyboard focus. Define this new command during implementation, not as an existing script.

### Task 5: Actual Chrome acceptance and release artifacts

**Files:** create `scripts/extension/{build,verify-artifact}.mjs`, `playwright.extension.config.ts`, `docs/chrome-extension.md`, `tests/extension-e2e/{native-host.spec,artifact.spec}.ts`; extend root validation/CI, packaging scripts, README and English synthetic screenshot capture configuration. Define `build:extension`, `test:extension`, `package:extension`, `verify:extension` at implementation time.

- [ ] Write artifact checks rejecting remote executable code, permissive CSP, added browsing permissions, real secrets/chats, native tokens, signing keys, dev endpoints and test-only bridges. Verify each bundled resource and emitted native manifest against the selected extension ID/build version. Keep ZIPs, private logs and browser profiles in ignored output directories.
- [ ] Exercise actual stdio/native registration with an isolated test installation, real worker termination, Chrome restart, extension update, browser close while synthetic agent runs, revoked grant, missing host, conflicting version and simultaneous desktop/Telegram controlled viewers. Never install test registrations into the user's normal Chrome profile or terminate existing sessions.
- [ ] Run `npm run validate`, `npm run test-storybook`, `E2E_APP_PORT=4175 npm run test:e2e`, new `npm run build:extension`, `npm run test:extension`, `npm run package:extension` and `npm run verify:extension`; inspect outputs and review authority/lifecycle boundaries. CI runs Chromium automation; macOS native Chrome acceptance remains a separate required result.
- [ ] Verify developer-mode installation in actual Chrome and the signed/notarized companion on a clean test macOS account, including no development Node, real side-panel open, full-tab navigation, file download and product-only uninstall. Record exact browser versions and browser-specific host-registration paths. Do not use branded Chrome `--load-extension` automation assumptions or infer Chrome success from a mocked panel page.
- [ ] Document English install/agent startup, scope/permissions, local data and revocation behavior, native-host diagnostics and synthetic screenshots. Produce an internal ZIP/companion artifact; Chrome Web Store upload, listings, privacy declarations and public companion hosting require separate publication authorization. Remote viewing/page capture/notifications remain later reviewed scopes.

## Remaining release acceptance

Run the internal verification commands in the linked workflow, then complete the outstanding native release checks in Task 5. Keep production credentials, personal browser profiles, actual conversations and terminal recordings outside acceptance fixtures. No commit, browser registration or public distribution is part of the internal artifact handoff.
