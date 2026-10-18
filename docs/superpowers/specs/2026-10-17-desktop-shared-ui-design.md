# Desktop application with a shared React UI

Status: proposed design, planning only. The user requested a desktop implementation plan using Tauri or Electron and reusing the existing UI. This request does not authorize scaffolding, dependency installation, account changes, commits, deployment or desktop implementation. Existing subscription-switching work remains separate.

## Intent and planning assumptions

Ship an installable desktop application that uses the same session list, conversation, images/files, questions, approvals, diffs, subagent activity, queue controls and future Accounts & keys page as the Telegram Mini App. Features and fixes must remain in one React implementation.

Planning assumptions, not user-confirmed platform requirements: macOS first, with autonomous local session control and optional Telegram remote access. Local operation does not require Telegram, a relay, PostgreSQL, Redis or Docker. An optional future remote-only desktop client is a separate authentication/transport phase. Windows/Linux cannot claim macOS-native connector support merely because the shell starts there. The final minimum OS must satisfy the pinned shell, native runtime and Swift helper, with macOS 13 as the existing helper floor.

## Framework decision

| Option                                            | Fit for this repository                                                                                                              | Main cost / acceptance gate                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron + bundled UI + standalone Node companion | Recommended first implementation: TypeScript host, Chromium rendering and existing Node daemon retained behind a narrow IPC boundary | Larger distribution; sign/package Electron, Node and helper; verify detached companion lifecycle                                                |
| Tauri 2 + same UI + Node sidecar                  | Viable alternative when distribution/runtime footprint is the priority; Rust host delegates agent logic to the same companion        | Rust packaging/IPC plus system-WebView coverage and platform-specific sidecars; measure total installed size including Node                     |
| Desktop window loading the public Mini App URL    | Suitable only as a disposable comparison                                                                                             | Does not solve local operation, Telegram-specific authentication, native lifecycle or trusted renderer boundaries; not the product architecture |

This recommendation is an inference from the current code and official framework documentation, not a measured performance claim. Pin a maintained compatible release during the packaging probe; do not hardcode an unverified current version or promise bundle/RAM savings. Do not implement both shells in the first release.

## Existing boundaries that must change

- `apps/mini-app/src/entities/session/model/use-session-connection.ts` currently reads Telegram `initData` and constructs `AppTransport`; no Telegram identity means expired authentication.
- `shared/api/transport.ts` combines the public client facade with HTTP/WebSocket login, cookies, events and command recovery. Preferences/rename/device features also use its generic HTTP request method. A transport interface must cover all these consumers, not only message submission.
- `shared/api/attachments.ts` assumes browser `File`, XHR and authenticated HTTP blobs. Desktop IPC must adapt upload/download/abort/progress without leaking credentials or filesystem paths.
- `src/app/app.tsx`, `remote-application.tsx`, providers and FSD slices already define the reusable UI. `index.html` loads Telegram's remote script; a desktop entry must not load it.
- `apps/daemon/src/main.ts` requires relay pairing config during startup. Local UI needs an independently startable headless runtime with an optional relay client.
- `create-session.ts`, `restart-session.ts`, `code/install-hooks.ts` and CLI setup use `process.execPath`. Electron's executable must not become the Node executable embedded in terminal commands or hooks.
- `node-pty`, `better-sqlite3`, the Swift helper and source-owned cmux/terminal launch context must survive packaging and application updates.

## One UI, multiple host adapters

The [Chrome extension design](2026-10-17-chrome-extension-shared-ui-design.md) reuses these same boundaries with a Native Messaging adapter. Shared host/client extraction and local companion foundations are delivered once; Chrome does not depend on an Electron/Tauri window.

Keep `apps/mini-app` as the shared frontend source initially. Add separate Telegram and desktop entrypoints/build targets instead of copying components or immediately moving the whole FSD tree into another package. A later extraction to `packages/client-ui` needs its own reason and migration; it is not required to reuse the UI now.

Introduce an `ApplicationClient` contract with typed session/device queries, subscriptions, bounded history/paging, commands and reconciliation, bookmark/preferences mutations, renaming, pairing/access management and `AttachmentAccess`. Future profile/continuity operations extend this same contract. `TransportRuntime` stores that interface; it no longer depends on the concrete Telegram transport class.

Introduce `HostAdapter` for client creation, theme/locale integration, file picking, external links, notifications and host capabilities. Telegram implements it with the current authenticated relay transport and WebApp integration. Desktop implements it with a constrained preload bridge to the host process and local companion. Stores, reducers, TanStack Query queries, command IDs and UI controllers remain shared. Do not expose a generic `request(url)`, arbitrary `ipcRenderer`, filesystem or shell API to renderer code.

The desktop window renders bundled assets with the existing styles, accessibility semantics, RU/EN dictionaries and desktop-responsive layout. Preserve mobile behavior. Desktop-only window chrome, shortcuts and menus belong in the host adapter or thin shell components. The same Storybook fixtures exercise both hosts with synthetic data.

## Local authority and optional remote access

Split the companion runtime from relay attachment. It can start in local mode with a persisted installation/device identity and a local owner scope, using SQLite for preferences, reading positions, history indexes, command receipts and operation journals. Existing bounded native history readers remain the content source; do not read a whole transcript or create another agent engine.

Only the privileged desktop host connects to a dedicated companion-client endpoint in an owner-only state directory. Use a separate role/capability from the hook/wrapper secret: fixed commands, bounded typed frames, protocol-version handshake, per-client epoch and revocation. Validate directory/socket/file ownership and restrictive permissions. Renderer windows receive a limited event/action bridge; credentials, daemon tokens, provider logins and raw local paths stay outside them. Local OS-account control is the local trust boundary; it is not an assertion of Telegram account ownership.

Local owner scope and relay owner scope remain distinct. Pairing or importing existing relay state requires an explicit approved mapping from the authenticated remote owner/device grant; never relabel local profiles or copy credentials into another owner's namespace. Locally created sessions remain local until explicitly shared. An existing paired daemon must not be replaced with a fresh state directory or silently re-paired. Protocol/ownership mismatch produces an actionable attach failure, not another background daemon.

Telegram remote access attaches as an optional relay adapter to the same runtime/dispatcher. Local and remote clients use one command journal, permission/question brokers and session generations, so answering or delivering through both paths cannot duplicate an operation. Relay outage does not stop local work; remote access accurately reports its own offline state. Remote-only desktop viewing, if added later, needs a separately approved viewer login and grants; do not reuse a companion device token or fabricate Telegram `initData` in a desktop renderer.

## Companion and native runtime packaging

Use an independently running standalone Node companion for the first release. Bundle the selected supported Node runtime, compiled daemon, its ABI-matching native dependencies and the Swift helper as signed resources outside renderer assets. Do not require a globally installed Node or a GUI-launched shell to have an interactive terminal's PATH. Discover installed Claude/Codex executables through validated local launch configuration and keep their own authentication flows.

The host connects to a compatible existing companion before starting a new one. An owned new companion uses an independent lifecycle with private bounded logs and a verified runtime manifest. Window close and normal UI quit do not stop the companion or user sessions. Starting twice reuses one instance. Explicit Stop companion explains its managed-PTY consequences and does not kill unmanaged terminal/cmux processes. Login-item installation is opt-in; it is not a default side effect of application installation.

Resolve trusted Node, daemon entrypoint, helper and resource paths explicitly. Preserve executable permissions, CPU architecture, module ABI and code signatures after install/move/update. Hooks/terminal launchers must reference a stable managed runtime location; do not replace them with a transient DMG mount, temporary unpack directory or Electron `process.execPath`. Updating owned runtime resources waits for an explicit idle/maintenance boundary and never invalidates an active daemon's executable dependencies.

Electron `utilityProcess` is an alternative only after native-addon ABI rebuilds and all child-process/hook paths are verified. It is not assumed compatible with the current Node archive. Tauri uses the same standalone companion as a fixed backend-owned sidecar; its renderer does not receive unrestricted shell-spawn permissions.

## Desktop security and media

Electron uses `nodeIntegration: false`, `contextIsolation: true`, renderer sandboxing, bundled preload and a restrictive CSP. Validate sender window, top-level frame, exact trusted origin, lease and every schema at the IPC boundary. Reject unexpected navigation/window creation, untrusted custom-protocol traversal and unknown operations. Open user-approved HTTP(S) links in the system browser; do not execute arbitrary protocols supplied by messages or deep links. Production bundles do not contain test-only bridges or a loaded remote frontend.

Use a dedicated application asset origin and opaque attachment IDs. Upload bytes in bounded chunks (at most 256 KiB per IPC chunk) with backpressure, generation/owner checks, cancellation and existing file-size limits. Downloads/previews resolve through the authorized companion store; never accept arbitrary absolute file paths from the renderer or a deep link. Reuse the fullscreen image viewer, zoom/reset and object-URL cleanup. Large histories stay paged; navigation does not reconstruct or duplicate native conversations.

Tauri applies equivalent typed commands, restricted capabilities and bundled assets. Sidecar startup belongs in the trusted backend with fixed paths/arguments. If native WebDriver plugins are used for macOS acceptance, exclude them from production builds and inspect the resulting artifact.

## Product behavior and delivery boundaries

First deliver a shared host/client interface without changing Telegram behavior. Next prove packaged local companion startup/attach and safe shutdown with synthetic sessions. Then add the desktop shell and local UI, followed by optional Telegram attachment, settings/tray integration and signed distribution. Account-management and automatic subscription fallback reuse their existing plans and authoritative profile registry; the desktop shell must not duplicate or prematurely expose them.

Acceptance includes independent local launch without Docker/relay/Telegram, same-source UI parity, bounded history/bookmark restoration, Enter/queue/question/permission behavior, file/image/diff rendering, cmux/environment retention, no duplicated companion after restart, local/remote concurrent receipts, owner isolation and intact active native sessions when the window closes. Verify on a clean Mac with no development Node. English synthetic screenshots and Storybook states are the only public visual evidence.

Not in the first release: parallel Electron/Tauri products, automatic account purchases/sign-ins, a rewritten agent engine, undocumented Desktop connector promises, automatic OS login registration or forced application/runtime updates during an active task.

## Checked primary references

Checked 2026-10-17:

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [utility process](https://www.electronjs.org/docs/latest/api/utility-process).
- [Electron native module ABI](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite), [macOS distribution](https://www.electronjs.org/docs/latest/tutorial/code-signing).
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [capabilities](https://v2.tauri.app/security/capabilities/), [WebDriver options](https://v2.tauri.app/develop/tests/webdriver/).
- [Playwright Electron support](https://playwright.dev/docs/api/class-electron): native-shell testing is distinct from renderer-only browser tests.
