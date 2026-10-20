# Desktop development

The internal Electron application uses the same React application, account controls, history and attachment UI as the Telegram and Chrome hosts. Its renderer entry is `apps/mini-app/desktop.html`; the host and sandboxed preload are in `apps/desktop`. It does not load the Telegram SDK.

## Build and checks

Use the [repository setup](../README.md#agent-quick-start-isolated-development) and disposable test database. From the repository root:

```sh
npm run validate
npm run test:desktop
```

Validation includes Desktop source formatting, TypeScript, the sandboxed renderer/main/preload build and unit/integration tests. `npm run build:desktop` builds only `apps/desktop/dist/main`, `preload` and `renderer`; it does not download a runtime, authorize a local client or open an account.

Desktop tests use synthetic identities, temporary private directories and controlled native peers. The Electron fixture injects a main-process confirmation callback and browser opener in its test entry. Production uses a native confirmation dialog and the operating system browser. Tests never sign into personal accounts or consume inference.

## Internal macOS package

Build the helper and application from the repository root:

```sh
npm run build:helper
npm run package:desktop
```

Packaging builds the shared application and Desktop bundles, prepares `apps/desktop/dist/desktop-companion`, verifies its manifest and runs Electron Forge under the verified pinned Node runtime. The build launcher also places that runtime first on its child process PATH, so Forge does not depend on the shell's Node version. Forge output is under `apps/desktop/out/`. These directories and downloaded toolchains under `output/toolchains/` are ignored by Git.

The companion uses pinned Node 22.23.3, ABI 127, for macOS arm64 or x64. The downloader verifies the official archive checksum before extraction. Packaging verifies the runtime target, dependency files, helper, entry point and resource hashes. An arbitrary `DESKTOP_STANDALONE_NODE` override is unsupported. The independent companion runs under this Node runtime rather than Electron's ABI.

Runtime resources are installed into a private versioned user-data directory, so a running companion does not depend on a mounted archive or a moved application bundle. Native-module and helper compatibility must be verified on each supported target.

## First local connection

Desktop requests approval for its own fixed local identity. Review the native confirmation dialog on the Mac to grant access. A renderer cannot approve itself. Chrome Native Messaging identities and Telegram pairing remain separate.

The application shows the local operating-system account's approved sessions and profiles. It does not import a relay principal or another owner's remote metadata. Closing or reopening a viewer reuses the independent companion; closing the viewer does not terminate agent processes. Revocation remains effective on reconnect.

The sandboxed renderer has no Node.js access, generic IPC channel or native credential handle. Main-frame and origin checks fence IPC. Profile sign-in opens only the supported provider's validated authorization URL in the system browser. Other popup creation, arbitrary navigation, webviews and renderer permission requests are denied.

## Release order

Deploy the relay and the mini-app before shipping any daemon build that reports a new session error code: the desktop build (`package:desktop`) and the CLI daemon (`package:daemon`, run as `apps/daemon/bin/remote.mjs`) both carry the daemon. The first such code is `CODEX_FRAME_TOO_LARGE`, shown when a Codex thread's state exceeds the 32 MiB IPC frame cap. Relays and mini-app bundles that are already deployed validate session error codes strictly. They reject every snapshot from a device that reports an unknown code. Builds from this release onward read an unknown session error code as `SESSION_UNAVAILABLE` instead.

Subagent history follows the same order for both daemon builds, the desktop build and the CLI daemon. A daemon from this release adds `type`, `description` and `transcriptAvailable` to a session's subagents, `subagentHistory` to its capabilities and tool activity to subagent history items. Relays and mini-app bundles that are already deployed parse these objects strictly and reject the whole snapshot. From this release they strip unknown subagent, capability and history item fields, read an unknown subagent status as `unknown`, an unknown tool kind as `tool` and an unknown tool phase as `completed`. Tool results carry only their outcome, never their output. The relay sends a subagent history request (`agentId`) only to a session whose daemon reports `subagentHistory`, because an older daemon closes the connection on that request. An older relay ignores `agentId` and would answer with the parent session's history, so deploy the relay before the mini-app that opens subagent views.

The daemon↔relay protocol version follows the same order once more. A daemon from this release sends `protocolVersion` in its device `Auth` frame. Relays that are already deployed parse that frame strictly: they answer `INVALID_REQUEST`, close the connection and the daemon keeps retrying. Deploy the relay before any daemon build that sends `protocolVersion`: the desktop build or the CLI daemon (`package:daemon` / `remote.mjs`). From this release the relay strips unknown `Auth` fields, so later fields no longer need this order; frame changes from version 2 on are announced by the negotiated version instead.

A relay that does not support the daemon's version closes the connection with `PROTOCOL_UNSUPPORTED` (close code 4004). The daemon stops reconnecting, reports the code on stderr and in `remote status`, and probes the relay again every 10 minutes, so a relay rollback or upgrade recovers on its own. Restart the daemon after updating the desktop build or the relay to reconnect at once.

## Acceptance status

Controlled tests cover SQLite and PTY under the packaged Node runtime, local grants, revocation, companion survival, the actual Electron bootstrap and the shared UI. Synthetic native peers establish protocol behavior rather than real provider-account acceptance. A safe probe separately checks the built Swift helper without requesting new macOS permissions.

The package is an internal unsigned development artifact. Developer ID signing, notarization, clean-machine installation, real disposable-account sign-in and supported native-session acceptance are required before public distribution. Conversation handoff and automatic quota fallback are still under implementation; their server metadata and checkpoint foundations do not enable those controls.
