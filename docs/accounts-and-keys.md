# Accounts and keys

The development UI includes an **Accounts & keys** page shared by the Telegram Mini App, Chrome extension and Desktop host. The Mac companion owns profiles and credentials. The relay stores only strictly validated metadata for offline display.

## Current scope

- Create, rename, enable, disable and remove isolated Codex profiles; save a preferred profile for each provider.
- Start official OpenAI subscription sign-in in a separate native configuration root and verify the native account/workspace before marking a profile connected.
- Encrypt an API key in the browser, enroll it on the Mac through native stdin, and verify it with the protected OpenAI models endpoint without inference.
- Recover operations by saved IDs after a lost response or companion restart. Unknown writes are checked instead of automatically repeated.
- Show cached metadata offline with account mutations disabled.
- Explicitly select a ready Codex profile, model and supported reasoning effort when creating a session. A removed, disconnected or changed selection remains visible and blocks submission until resolved; it never silently becomes the native default.

Moving a conversation between providers, quota policies and automatic fallback remain unfinished. Saving a preferred profile does **not** reroute existing sessions or replace the explicit native-default creation option. Claude isolation has a private adapter foundation, but authenticated Claude subscription sign-in and profile-aware Claude creation remain unavailable. Desktop uses local Codex profiles through the same management UI; selecting accounts in an existing native agent application is a separate connector capability. Controlled peers verify this implementation; real disposable-account acceptance remains a release gate. See [compatibility evidence](provider-profile-compatibility.md).

## Using the development UI

Follow the [repository setup](../README.md) to install dependencies, build and run the fixture-based UI. Rebuild the companion before trying the new CLI command. Development does not require changing existing production services or pairing.

From the session list, open **Accounts & keys**, enter a profile name and choose a subscription or API-key profile. A newly created profile requires authentication.

For a subscription, choose **Sign in on Mac**, follow the returned official OpenAI sign-in link, then choose **Check operation status**. The account label and workspace come from native metadata rather than the profile's user-entered name.

For an API key, run this on the destination Mac:

```sh
remote profiles recipient
```

Paste the printed fingerprint into **Mac fingerprint**, enter the key and choose **Encrypt and save on Mac**. The fingerprint must come from the Mac independently of the relay. An untrusted destination, expired challenge or invalid ciphertext prevents enrollment. The key field is cleared when submitted.

If a reply is lost, **Check operation status** appears before further changes are allowed. This survives page reloads. The browser retains only the opaque operation ID, never the key, encrypted envelope, login URL or original request. It refreshes metadata after failed requests. An unused expired challenge becomes a failed operation when checked, allowing a fresh enrollment.

## Storage and lifecycle

Profiles use separate private native configuration, credential and home directories. Parent API-key and gateway environment variables are excluded. Codex explicitly uses its profile-local file credential store. No global login is replaced.

The browser sends a sealed-box envelope bound to the owner, device, profile version, operation ID, single-use nonce and five-minute expiry. Plaintext keys are absent from relay requests, profile responses, operation journals, browser persistence and query caches. The independently pinned Mac decrypts the envelope; the selected provider's credential file stays on that Mac with owner-only permissions.

Deletion removes a profile's credential only after native cleanup is acknowledged. Existing history is preserved; removing a local profile does not revoke the provider account. Disabling or removing a profile prevents an older asynchronous result from making it ready.

Logout or disconnection invalidates pending local and relay request fences before subsequent native effects or readiness updates. A write already accepted by the native process may have completed; its operation is retained for explicit reconciliation rather than replayed. A subscription sign-in whose URL was already delivered can still finish its native callback after the viewer closes. It does not mark the profile connected until a newly authorized status check verifies the account. Real callback acceptance remains unverified.

Account lists travel from the Mac to the relay in bounded pages with a shared revision. A changed registry rejects mixed pages. Oversized replies fail the individual request without closing the device socket. Offline metadata does not disable the refresh action after reconnection; a returning Mac triggers a fresh read before mutations become available.

## Verification

Unit and integration tests cover ownership, version fences, independent roots, native account evidence, protected API verification, replay, pin substitution, expiry, malformed ciphertext, lost responses, logout and process cleanup. Browser tests use a real relay and controlled native children. Chrome tests exercise the built MV3 artifact and real Native Messaging framing under production CSP.

All account fixtures use synthetic identities. Tests do not sign into personal accounts, inspect existing credentials, consume inference or exhaust subscriptions.
