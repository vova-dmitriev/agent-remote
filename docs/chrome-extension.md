# Chrome extension: internal macOS workflow

The Manifest V3 side panel and full extension tab use the existing React UI in `apps/mini-app/src`. The extension owns the browser adapter and service-worker broker; the companion owns sessions, commands, grants and durable local state. Closing a panel, tab or browser disconnects its bridge and leaves the independently supervised companion running.

This is an internal, unsigned implementation. It has no Chrome Web Store release or signed/notarized companion distribution. The existing `output/companion-extension-internal-final` artifact uses Node **22.12.0**, macOS arm64 and Node ABI **127**; it is a development measurement, not a maintained-runtime or clean-install acceptance claim. Choose a maintained Node patch, verify the bundled Swift helper and complete native acceptance before release.

## Build and verify

Use synthetic sessions and a clean test macOS account. Do not install test registrations into a personal browser profile or restart an existing companion to run acceptance.

From the repository root:

```sh
pnpm build
pnpm build:extension
pnpm test:extension
pnpm test:extension:e2e
pnpm package:extension
pnpm verify:extension
```

The extension directory is `dist/chrome-extension`; the internal ZIP is `artifacts/chrome-extension/agent-remote-chrome-extension.zip`. The verifier checks the compiled manifest, local resources, permissions, CSP, executable code and sensitive/development content. A successful build alone does not establish native browser acceptance. Extension E2E traces use ignored `output/extension-playwright-results/`, separate from the mobile suite's `test-results/`; both suites must keep their own disposable browser profiles and native registration roots.

Package an explicit standalone Node runtime without relying on a globally installed Node at launch:

```sh
TRUSTED_NODE='/absolute/path/to/maintained-node'
COMPANION_RUNTIME="$PWD/output/companion-internal"
node scripts/extension/package-companion.mjs --outDir "$COMPANION_RUNTIME" --node "$TRUSTED_NODE"
```

The output directory must be new and under this checkout's ignored `output/` or `artifacts/`. Packaging copies the compiled daemon/protocol/transport modules, CLI launcher and required production dependency trees. `runtime-manifest.json` records the Node version, architecture, ABI, protocol version and Node/launcher SHA-256 hashes. When `artifacts/ClaudeRemoteBridge.app` is present, packaging copies the helper bundle and records its executable path/hash; an absent helper is recorded as `helper: null` and remains a native integration gate. `SIGNING.txt` records the remaining distribution gates. Keep the artifact at a stable installed location; do not register an executable on a temporary mount or remove resources used by an active companion.

Targeted fixture checks:

```sh
pnpm exec vitest run tests/browser-cli.test.ts tests/native-host-registration.test.ts tests/local-companion-supervisor.test.ts tests/packaged-companion.test.ts
pnpm exec vitest run tests/native-host-grant.test.ts tests/native-message-framing.test.ts tests/extension-build.test.ts
```

Run the repository's full [verification workflow](../README.md#verification) before claiming readiness. The packaged-companion fixture starts the actual bundled daemon, authenticates its private health endpoint, and resolves an isolated synthetic helper with no development Node/PATH or helper override. This does not verify macOS Accessibility. The isolated bundled-Chromium suite covers the real MV3 worker, framed native host, restart recovery, concurrent viewers, bookmarks, queued commands and image downloads. Actual branded Chrome toolbar/side-panel behavior, browser update/restart and signed clean-account installation remain release gates.

## Install on the test account

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome-extension`. Record the displayed extension ID. See Chrome's [unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).
2. Choose the matching browser kind: `chrome`, `chromium` or `chrome_for_testing`. Use the same private state directory for installation, authorization and the companion.
3. Run the explicit registration command below. Replace the extension-ID placeholder with the exact 32-letter ID containing only `a`–`p`.

```sh
COMPANION_RUNTIME="$PWD/output/companion-internal"
COMPANION_HOME="$HOME/.claude-remote"
BROWSER_KIND='chrome'
EXTENSION_ID='<32-letter-extension-id>'
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser install "$COMPANION_RUNTIME" "$BROWSER_KIND" "$EXTENSION_ID"
```

Installation validates the package paths and checksums, creates an owner-only wrapper/settings file, and registers `com.agent_remote.companion` for the exact origin. It refuses symlinks, unsafe ownership/permissions and unrelated existing registration. Repeating the same installation is safe; changing its runtime or origin requires an explicit maintenance uninstall/reinstall.

The current macOS user-level manifest locations are:

| Browser kind         | Directory under `~/Library/Application Support/` |
| -------------------- | ------------------------------------------------ |
| `chrome`             | `Google/Chrome/NativeMessagingHosts/`            |
| `chromium`           | `Chromium/NativeMessagingHosts/`                 |
| `chrome_for_testing` | `Google/ChromeForTesting/NativeMessagingHosts/`  |

Each directory contains `com.agent_remote.companion.json`. Chrome for Testing has a separate registration directory starting with Chrome 146; older versions used Chrome's directory. This implementation uses the distinct current location. Windows/Linux registration remains unsupported. See Chrome's [native-messaging registration reference](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## Approve and use the local client

Open Agent Remote from the extension toolbar. Its global side panel can open the same UI in a full tab. The first connection creates a pending client request; an extension ID in `allowed_origins` does not approve that client.

List pending clients and approve only the client and extension ID you recognize:

```sh
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser pending
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser authorize
CLIENT_ID='<pending-client-id>'
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser authorize "$CLIENT_ID" "$EXTENSION_ID"
```

Both listing commands print pending IDs and an approval command; they print no client handle or capability. Approval applies to the exact pending request. Reconnect the extension after approval. Each browser profile has its own client identity; a provider subscription/profile is a different concept.

The host attaches to an authenticated compatible local companion before starting one through the supervisor. Foreground local startup is also available for deliberate diagnostics:

```sh
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser start-local
```

This trusted local mode enables session input. Permission automation remains off unless explicitly enabled with `REMOTE_PERMISSIONS_ENABLED=1`. Interrupting a foreground companion deliberately stops its owned services; do not use that as a browser-disconnect test. `browser host <caller-origin>` is reserved for Chrome's framed stdio invocation, not interactive terminal use.

Local authorization belongs to this OS-account installation. It does not authenticate a Telegram owner, import remote sessions, approve a provider login or expose provider credentials. The extension receives a revocable client handle; the private local capability, hook secret and device token remain in the companion. The package requests only `sidePanel`, `nativeMessaging` and `storage`; incognito is disabled.

## Attachment sharing limits

New paired native exports are imported into the local cache under the relay's exact descriptor ID. Preparing an extension upload attempts a bounded relay mirror when pairing is configured. Native dispatch keeps its original descriptors; only persisted history adopts the validated canonical relay ID after successful local import.

Local input continues during relay outage or cache quota pressure. If relay deduplication maps several files to one ID, history retains the original distinct local IDs to preserve a valid durable record. Attachments prepared in that state can retain local-only IDs and are not guaranteed readable by a paired Telegram viewer; there is no automatic cross-surface transfer replay. Older uncached relay IDs remain explicitly unavailable to local readers until a trusted descriptor and its bytes are imported. The local media API does not invent metadata or expose an arbitrary relay/URL proxy to recover them. Treat these cases as remaining cross-surface acceptance gaps.

## Revoke, uninstall and update

Revoke a client without signing providers out or stopping other sessions:

```sh
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser revoke "$CLIENT_ID"
```

To explicitly reauthorize the same revoked client, use the exact client and extension IDs, then reopen the extension:

```sh
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser authorize "$CLIENT_ID" "$EXTENSION_ID"
```

This issues a new handle; old handles stay invalid. Previously acknowledged unsent queue entries remain owned by this installation and can resume after authorization.

Remove this product's registration for the selected browser:

```sh
CLAUDE_REMOTE_HOME="$COMPANION_HOME" "$COMPANION_RUNTIME/runtime/node" "$COMPANION_RUNTIME/apps/daemon/bin/remote.mjs" browser uninstall "$BROWSER_KIND"
```

Uninstall preserves neighboring registration files and session/grant databases. The common wrapper/settings remain while another supported browser registration exists; the final removal cleans up only the matching product wrapper/settings. It does not terminate a companion or agent process. Remove the unpacked extension separately in the browser UI.

For relocation/update, uninstall the owned registrations explicitly, retain the prior runtime while its sessions are active, then install the new trusted runtime during an agreed idle maintenance window. No automatic replacement of a running companion is performed. Developer ID signing/notarization and review under the [repository security policy](../SECURITY.md) are required before public companion distribution or [native-host installation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) in a release workflow.

## Troubleshooting

| Error/state                                           | Action                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing host / `LOCAL_HOST_UNAVAILABLE`               | Check the selected browser directory, exact extension ID and installed runtime resources. Run the explicit installer on the test account.   |
| `LOCAL_APPROVAL_REQUIRED`                             | List pending clients and approve the exact client/extension pair in the trusted CLI.                                                        |
| `LOCAL_GRANT_REVOKED` / `UNAUTHORIZED`                | Check the selected client and exact allowlisted origin. Revoked/incorrect handles do not grant access.                                      |
| `LOCAL_COMPANION_MISMATCH` / version mismatch         | Preserve the existing companion. Check its protocol/installation identity; a legacy hooks socket without a client endpoint blocks startup.  |
| `LOCAL_COMPANION_TIMEOUT` / `LOCAL_RUNTIME_UNTRUSTED` | Check owned paths, permissions, hashes and startup state. Ambiguous startup locks fail closed; inspect them during maintenance, not by age. |

The application protocol is **1**. Native frames are limited to **512 KiB of encoded bytes**, raw media chunks to **256 KiB**, logical messages to **8 MiB**, and aggregate pending reassembly to **16 MiB** with **30-second** fragment expiry. Stable command reservations contain only fingerprints and expiry, with a hard limit of **10,000** records. A full reservation store rejects new commands rather than discarding deduplication evidence; preserve its database for explicit maintenance. Attachment budgets remain **10 MiB per file**, **five files**, **20 MiB total per message**. Oversized or incompatible messages fail explicitly; browser reopen does not authorize blind replay of an unconfirmed write.

The manifest's minimum Chrome version **116** is an API compatibility floor, not a supported-old-browser recommendation. Keep development and release IDs explicit, and never put signing private keys, provider credentials, actual conversations or personal browser data into the extension ZIP or acceptance fixtures.
