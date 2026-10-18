# Chrome extension with the shared React UI

Status: internal implementation authorized and delivered against this design; native release acceptance remains open. See the [implementation status](../plans/2026-10-17-chrome-extension-shared-ui.md#execution-status) and [internal macOS workflow](../../chrome-extension.md). Personal browser installation, commits and publication require separate authorization. Subscription-switching work remains separate.

## Intent and assumptions

Open Agent Remote from Chrome and use the same sessions, conversations, queue controls, questions, approvals, images, diffs, reading positions and future Accounts & keys page. UI fixes must reach Telegram, desktop and Chrome through one implementation.

Planning assumptions: desktop Chrome, macOS first, local companion connection first. Other operating systems require separate native acceptance; Telegram remains the mobile client. A separately installed companion is required for local CLI control, but the Electron/Tauri window does not need to be running. Remote relay viewing is a later authentication phase, not silently included in local mode.

## Surface decision

| Option                                         | Decision                       | Reason                                                                                                                       |
| ---------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Manifest V3 side panel plus full extension tab | Recommended                    | Keep a conversation beside the current page; open the same bundled UI in a wider tab for images, diffs or long conversations |
| Toolbar popup containing the application       | Launcher only, if needed later | Popup lifetime and width are unsuitable for sustained conversation reading                                                   |
| Embedded public Mini App website               | Not selected                   | Retains Telegram-specific login and does not establish a local native authority boundary                                     |

Use a global side panel, not a separate session per browser tab. Toolbar action opens it through `sidePanel.setPanelBehavior`; an extension UI button opens the full tab. Declare `minimum_chrome_version: "116"` for the chosen API surface, not as a recommendation to run an unsupported old browser. Do not require newer close/open lifecycle APIs without updating that floor. This surface recommendation is a product inference from the current UI and the official Side Panel API.

## Shared boundaries and existing dependencies

Reuse `apps/mini-app/src` directly. Add an extension HTML/bootstrap/build target; do not copy pages, stores, account forms, styles or translations into `apps/chrome-extension`. That directory owns only manifest, service worker, Chrome adapter and packaging configuration.

The shared `ApplicationClient` and `HostAdapter` described in the [desktop design](2026-10-17-desktop-shared-ui-design.md) are shared prerequisites and are now implemented for the Telegram and Chrome hosts. Reuse them for the future desktop shell. Desktop Task 1 owns the extraction; desktop Tasks 2–3 own the independently startable companion and trusted standalone Node runtime. These foundations can be delivered before an Electron/Tauri window and must not be duplicated for Chrome.

`use-session-connection.ts` currently requires Telegram `initData`; `AppTransport` combines HTTP/WebSocket auth and generic HTTP requests. Existing HTML loads Telegram's remote script. Chrome needs its own client and bootstrap, while the shared UI receives typed operations through the same interface. Rename, preferences, device access, reading positions and attachments must migrate with commands; a send-only adapter is insufficient.

The Chrome adapter supplies file inputs, safe external links, theme/locale and capabilities. Existing fullscreen image zoom/reset and highlighted diff views remain shared. Extension-specific installation/connectivity UI is thin and localized. Account selection and quota fallback use the companion's authoritative shared profile engine only after its own plan is implemented; Chrome never creates a second credential registry or infers account readiness.

## Local connection and authority

Use `extension page -> service worker -> Native Messaging bridge -> companion local-client endpoint`. Chrome starts a small stdio bridge for `connectNative`; it does not become the session-owning daemon. The bridge attaches to the same independently running companion as desktop/Telegram, starting a compatible owned companion only through the shared supervisor. Closing a panel, ending a port or restarting Chrome must not kill or restart native sessions.

The companion installer registers native host `com.agent_remote.companion` with an absolute trusted executable path and exact `allowed_origins`. Development and release extension IDs are separate allowlists; a public development manifest key may stabilize the test ID, while signing private keys never enter Git or extension assets. Validate the caller origin passed by Chrome and a protocol-version handshake. Resolve browser-specific manifest locations explicitly: Chrome, Chromium and Chrome for Testing do not necessarily share registration paths.

The bridge alone accesses the owner-only companion-client endpoint and its dedicated capability. Never expose the hook secret, device token, provider credentials, credential files or arbitrary local paths to extension storage or bridge responses. Native operations use named strict schemas, request IDs, owner/device scope, session generation and client epoch. No arbitrary shell command, filesystem access, HTTP proxy or executable path is accepted from a page.

Before first access, the companion approves and persists an extension-client grant; an allowlisted extension ID alone is not an owner login. Show the pending client in trusted desktop settings, or use an explicit `remote browser authorize` command when no desktop shell is installed. Approval identifies the pending request and exact extension ID; the extension cannot approve itself. Reconnection presents an opaque revocable client handle and verifies its scope locally. A browser profile and a provider subscription profile are different concepts. The grant identifies access to a local OS-account installation; it does not claim isolation from another program controlling that OS account. Remote owners retain separate namespaces and explicit pairing/import grants from the desktop design. Deny/revoke clears affected UI data and invalidates outstanding work; it does not stop unrelated sessions or sign providers out.

Only bundled top-level extension pages may request the service-worker broker: check `sender.id`, exact extension origin/page path and frame context, then validate every payload again at the bridge. Omit content scripts, `externally_connectable` and web-accessible application resources. Website messages cannot gain native access. This boundary does not make renderer injection harmless; retain markdown sanitization, CSP and narrow capabilities throughout.

## Lifecycle, durable state and concurrent viewers

Treat the MV3 service worker as disposable routing code. A native port can extend its lifetime, but crashes, extension updates and browser shutdown remain normal. Do not keep it alive with artificial timers or make it own long-running work. Reconnect with bounded backoff while a viewer exists; release the bridge when no viewer remains. Companion execution and its journal continue independently.

The companion owns accepted operations, command receipts and durable queued intents. Use stable IDs and compare-and-set revisions for queued edits or send-now transitions, including concurrent Telegram/desktop/extension edits. If a write is unconfirmed, query its receipt; never replay it automatically on panel reopen or service-worker restart. Persisting unsent drafts/queued attachments and exposing revisioned queue operations are release prerequisites if not already supported by the shared engine; current UI memory alone is not durable. An edited unsent intent never changes a command already dispatched.

Each side-panel/full-tab viewer has its own lease and subscriptions. Selecting a session in one viewer must not redirect an outstanding command or history response in another. Reading positions are scoped by owner/device/session and restored by message ID plus offset/cursor. Persist on scroll with bounded debouncing and flush on navigation; do not rely solely on an unload event. Resolve concurrent bookmark writes with an explicit revision; stale/hidden viewers cannot overwrite a newer acknowledged position. Initial history loads around the bookmark, or the latest bounded page if absent, never the complete transcript.

Keep shared Zustand/TanStack Query state in the UI. Store only safe bootstrap preferences and the revocable client handle in `chrome.storage.local`, restricted to trusted contexts; prefer companion-authoritative reading/draft state and no chat transcript cache in browser storage. Do not use `storage.sync` for private content or authentication, and do not treat `storage.session` as durable across browser restart. Restore locale before first UI paint to avoid the existing language-flash regression. Incognito is disabled in the first release.

## Framing and attachments

Native Messaging uses UTF-8 JSON with a native-endian 32-bit byte-length prefix. Reserve stdout exclusively for framed messages; redact diagnostics on stderr. Chrome's documented host-to-browser limit is 1 MiB. Set a stricter application frame limit of 512 KiB measured on encoded bytes in both directions, a maximum 256 KiB raw media chunk and one acknowledged chunk per transfer. Enforce existing attachment limits: 10 MiB per file, five files, 20 MiB total per message. Base64 and envelope overhead count toward the frame limit.

Bound history/event batches by encoded size as well as count. A logical message larger than a frame uses bounded fragments, never silent truncation. Set an 8 MiB encoded logical-message ceiling, 16 MiB aggregate pending reassembly per bridge and 30-second fragment expiry; test exact boundaries. Split batches into smaller pages before that ceiling. A single oversized item produces an explicit size error and preserves the source transcript. Reject oversized declarations before allocation and cancel partial reassembly on disconnect/epoch change. Do not send an entire large transcript through the bridge.

Uploads/downloads use opaque authorized attachment IDs, session ownership and abort/progress. Stage pending attachments in the companion with expiry; do not put whole files/base64 in extension storage. Reopening a panel resumes the draft from accepted attachment references, not a browser-only `File`. Clean cancelled/expired uploads, bound parallel transfers and revoke object URLs after use. Preserve image viewer, file download and existing total-message budgets in both tab and panel.

## Permissions, packaging and remote access

First-release permissions are `sidePanel`, `nativeMessaging` and `storage`. Opening an extension-owned tab does not require reading users' browsing history. No `tabs`, `activeTab`, `scripting`, `debugger`, `<all_urls>`, host permissions or webpage capture are required. Notifications and page-context sharing are separately scoped opt-in features, not incidental permissions.

Bundle all executable code and assets. The extension HTML excludes Telegram's remote SDK; production CSP disallows remote scripts, inline execution and eval, with `connect-src 'self'` for local Native Messaging mode and narrow `blob:` image/media allowances where required. Inspect the compiled artifact, not only source imports. No live sessions, credentials, dev-server URLs, signing keys or automation bridges belong in the ZIP or public screenshots.

Remote relay access, if subsequently requested, needs a viewer-specific login/grant flow, approved owner binding, revocation and exact optional HTTPS/WSS host permissions/CSP. Design one-time device approval with verifier-bound redemption and expiry before adding endpoints; do not reuse a companion device token, copy Telegram `initData`, rely on same-origin refresh cookies from `chrome-extension://`, or route through an arbitrary user-supplied URL. It shares `ApplicationClient` but requires a separate reviewed authentication plan.

The companion installer is separate from the Chrome Web Store package and also usable without a desktop window. Install/uninstall only this product's host manifest; never overwrite unrelated browser registration or stop user processes. Publish the extension and signed/notarized macOS companion only with separate release authorization. Missing host, incompatible version and denied local grant produce distinct actionable localized states.

## Acceptance and checked references

Test a packed/built MV3 extension, real service-worker restart, real stdio bridge and a synthetic companion in isolated browser/state directories. Cover two owners, two viewers, duplicate startup, grant revoke, unknown receipt, queue edit/send-now conflicts, bounded large history, exact bookmark/marker restoration, Enter/IME, attachments, diffs, subagents and packaged startup without global Node. Browser close must leave the synthetic agent alive. Mocked Chrome APIs or Storybook alone do not establish native integration.

Use Playwright's bundled Chromium with a persistent context for automated extension tests. Current Playwright docs warn that branded Chrome/Edge removed the command-line flags used for side-loading; do not claim `channel: 'chrome'` with `--load-extension` works. Separately verify actual Chrome's side panel and installed native host on a clean macOS account with reviewed synthetic data. Developer-mode loading and Web Store installation are distinct release checks.

Checked 2026-10-17: [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [storage API](https://developer.chrome.com/docs/extensions/reference/api/storage), [remote-code restrictions](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
