# Execution profile compatibility

Implementation status: isolated Codex profile management and encrypted enrollment are integrated into the shared Accounts & keys UI. Controlled native peers verify management through the relay and Chrome Native Messaging. Real authenticated account acceptance, profile-aware session creation, context handoff and automatic fallback remain unfinished. Existing creation rejects profile selection until its launcher can honor it; saving a preferred profile does not change its billing account.

## Management verification on 2026-10-18

| Check                                              | Evidence                                                                                                     | Remaining acceptance                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Persistent scoped lifecycle and operation recovery | SQLite tests, native/HTTP bound clients, browser CRUD and reload                                             | Real-account cleanup and native execution dependencies   |
| Two retained OpenAI subscriptions                  | Browser → relay → isolated controlled children; distinct account/workspace evidence survives reload          | Two separately authorized real disposable subscriptions  |
| Encrypted API enrollment                           | Libsodium sealed boxes, pinned Mac key, replay/expiry/binding tests, built MV3 and Native Messaging          | Real disposable provider key and supported configuration |
| Protected API-key check                            | Fixed bounded `GET https://api.openai.com/v1/models`, no redirects/inference; controlled fetch tests         | Actual endpoint with an authorized disposable key        |
| Offline display                                    | Strict metadata-only PostgreSQL cache; foreign/revoked reads denied; browser reload disables writes          | Production cache availability and retention              |
| Logout and cleanup                                 | Correlated cancellation, owner/epoch/version fences, authentication child exit before cleanup acknowledgment | Native revocation timing with real accounts              |

`remote profiles recipient` prints only the Mac's enrollment-key fingerprint. It does not print provider credentials. [Management instructions](accounts-and-keys.md).

Management verification: 1,006 unit/integration tests across 222 files, 291 Storybook cases, 174 mobile browser scenarios and 10 built-extension/native scenarios passed. Uncertain create/enrollment responses survive reload without repeating writes; local disconnect/logout fences, obsolete sign-ins, concurrent cleanup and bounded profile pages have regressions. README images use English Storybook fixtures.

Preparation for profile-aware launch now validates a captured registry version, rechecks native identity and offered model/effort, strips inherited credentials, and allocates short private account-derived Unix socket namespaces. A controlled socket child verifies the explicit launch environment. These internal APIs are not connected to new-session selection yet and do not establish authenticated provider compatibility.

## Observed on 2026-10-17

| Check                                                            | Codex CLI 0.149.0                                                                                                                                  | Claude Code 2.1.302                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Installed version/help in isolated temporary configuration roots | Verified                                                                                                                                           | Verified                                                                                                            |
| Official subscription login command                              | `codex login` / `codex login --device-auth`, help verified; not executed                                                                           | `claude auth login --claudeai` help verified; not executed; profile sign-in is not wired                            |
| API-key input                                                    | `codex login --with-api-key`, stdin option verified; no key supplied                                                                               | Not exercised                                                                                                       |
| Empty isolated credential store                                  | Two distinct `CODEX_HOME` roots with explicit `cli_auth_credentials_store="file"` both report not logged in; neither borrows a cached global login | Fresh `HOME` + `CLAUDE_CONFIG_DIR` reports `loggedIn:false`, `authMethod:"none"`; no existing credentials read      |
| Per-profile subscription isolation                               | Not applicable                                                                                                                                     | Official docs scope claude.ai logins and Keychain entries to `CLAUDE_CONFIG_DIR`; keyless Console OAuth is excluded |
| API-key helper isolation                                         | Not applicable                                                                                                                                     | `--bare --setting-sources '' --settings …` reports `api_key_helper` / `apiKeyHelper`; synthetic helper only         |
| Account/login and quota protocol shapes                          | Installed app-server generated schemas inspected offline                                                                                           | `auth status --json` help verified; authenticated identity schema not observed; quota unsupported                   |
| Two simultaneously authenticated subscription accounts           | Not verified                                                                                                                                       | Not verified                                                                                                        |
| Verified model discovery, context seed/resume across accounts    | Not verified                                                                                                                                       | Not verified                                                                                                        |
| Independent Desktop account selection                            | Unavailable in this implementation                                                                                                                 | Unavailable in this implementation                                                                                  |

Probes used disposable directories, removed provider credential variables from child environments, and did not inspect existing credentials, initiate a sign-in, send a prompt or consume model usage. Schema availability does not prove authenticated runtime behavior.

## Claude profile adapter evidence on 2026-10-18

- Installed Claude Code is `2.1.302`. Empty temporary `HOME` and `CLAUDE_CONFIG_DIR` returned `loggedIn:false`, `authMethod:"none"`, and the selected configuration directory.
- A synthetic `apiKeyHelper` with `--bare --setting-sources '' --settings …` returned `loggedIn:true`, `authMethod:"api_key_helper"`, `apiProvider:"firstParty"`, and `apiKeySource:"apiKeyHelper"`. This was a local status check; no model request ran.
- The adapter gives each subscription launch a distinct `CLAUDE_CONFIG_DIR`. API-key launches use `--bare`, an explicit helper setting, an owner-private profile key file, and an isolated environment. The helper rejects loose, foreign-owned, oversized, and symlinked files. API keys are checked with a bounded, redirect-rejecting `GET https://api.anthropic.com/v1/models` adapter; tests use a controlled fetch peer only.
- Launch setup alone never marks a profile ready. Verification requires native evidence for the selected auth mode, exact configuration directory, and a nonempty account reference. The CLI's unauthenticated JSON shape does not establish an authenticated identity schema, so this adapter does not mark any profile ready or enable profile-aware session creation.
- Subscription sign-in remains unwired: `claude auth login --help` is verified, but no profile-owned browser/login completion path exists in the adapter, and the existing authentication service is Codex-only. The explicit blocker is `CLAUDE_SUBSCRIPTION_SIGN_IN_NOT_WIRED`. No sign-in was started.

## Contract boundaries

- Profile summaries contain opaque IDs, scoped owner/device metadata, authentication mode, verified identity reference, supported capabilities, model offers and a version. Unknown fields are rejected, including keys, tokens, environment overlays and runtime paths.
- A ready profile requires verified identity metadata and supported credential isolation. Internal launch-plan validation checks exact profile/provider identity, readiness and offered model/effort. It consumes authoritative registry metadata rather than trusting a browser-supplied summary.
- Native executions retain provider-specific native session IDs and link to one logical conversation. Handoff requests fence conversation/profile versions, source generation and the checkpoint digest. The coordinator must enforce ownership and actual receipt/ready state; the schema alone does not authorize access or prove delivery.
- Checkpoint bodies remain local. Their metadata records complete/recent-window coverage and manual approval or an exact enabled policy version/context-scope digest. Automatic payloads are not labeled individually reviewed.
- No new profile fields are accepted by the existing create-session wire action yet. Add that capability together with the profile-aware launcher, native identity checks and version/owner validation.

## Release gates

Before enabling account selection, test two separately authorized disposable accounts with independent credential stores, sockets/locks and identity reports. Check refresh, reauthentication, removal and conflicting inherited credential sources. Do not replace a global login as a shortcut.

Before enabling automatic fallback, verify native quota signals, scope/reset reporting, a stable source boundary, one context delivery, queue/file behavior and crash recovery. Unknown account attribution, shared quota pools and unknown delivery receipts must block automatic inference. Desktop capabilities require their own acceptance.

References: [OpenAI authentication](https://learn.chatgpt.com/docs/auth), [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables), [Claude Code authentication](https://code.claude.com/docs/en/authentication).
