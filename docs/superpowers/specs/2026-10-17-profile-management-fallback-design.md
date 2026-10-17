# Account management and automatic profile fallback

Status: proposed design; planning only, not implemented. This extends the [cross-provider continuity design](2026-10-17-cross-provider-continuity-design.md). No account changes, credentials, live prompts or deployments are authorized by writing this document.

## Confirmed user requirements

Persist each user's connected subscription accounts and API credentials. Provide a separate page to add, manage and remove them. Allow automatic continuation on another connection when a limit is exhausted, with user-defined source/destination rules and retained task context. Support Claude and Codex, both subscription and API billing.

### Required scenario: two OpenAI subscription accounts

The user explicitly requires at least two independently authenticated OpenAI/ChatGPT subscription accounts, selectable for Codex as separate saved profiles. Label them, for example, `OpenAI Personal` and `OpenAI Work`. Both connections persist simultaneously across app and companion restarts; signing into B must preserve A and unrelated native logins. The UI shows the verified account/workspace identity and the currently active connection.

The user can manually choose either account and configure `OpenAI Personal → OpenAI Work` in Automatic mode. When the first account reports authoritative quota exhaustion, continue the same logical task on the second account without another login, copying credentials by hand or confirming that previously configured transition again. Preserve task context, project state, native terminal/cmux placement and reading position; queue handling follows the saved policy. Verify that the destination runtime actually authenticates as B before routing prompts there. Native resume is capability-dependent; a linked execution/checkpoint supplies continuity when isolated account profiles cannot safely reuse the same native thread.

Track quota observations separately by verified account/workspace/model scope while respecting any shared pool reported by the provider. Two labels for the same authenticated identity are not proof of two independent allowances. If B is also exhausted or unavailable, preserve the task and queue, show the reason and wait or offer manual selection; do not alternate indefinitely or use an API key unless the policy separately permits that destination. Return to A after a verified reset only according to the explicit return policy.

The saved object is an authenticated connection/profile, not a purchased subscription or a payment card. Removing a connection does not cancel the provider subscription or revoke a provider-issued API key globally.

## Accounts & keys page

- List owner-scoped connections with a user label, provider, account/workspace when verified, subscription/API billing mode, Mac availability, authentication state and current usage/reset information when supported. Distinguish cached, unknown and fresh usage; never invent a percentage or reset time.
- Add subscription accounts through their official login flows using isolated native profiles. Add an API connection with a label and protected credential enrollment. Allow several connections for each provider; selecting one must not replace another connection's login or a global native login.
- Provide rename, check connection, reauthenticate, replace API key, disable, set default and remove actions. The default affects future sessions, not an already running turn. Stored keys are never displayed or returned; replacing a key is a new enrollment.
- Show active sessions and fallback rules referencing a connection before removal. Disable new use immediately, invalidate dependent rule versions and await an acknowledged companion deletion before showing removal complete. Do not kill native user processes. In-flight work may already hold credentials; local removal is not a claim of provider-side revocation.
- Link to a separate rule editor from each connection and from the page. Session creation and continuation reuse the same profile registry and show the selected billing source.

## Persistence, ownership and credential entry

PostgreSQL stores owner/device-scoped safe metadata, defaults, lifecycle operations, routing policies and audit events. Local Mac storage holds credential handles and profile runtime roots; secrets belong in an isolated Keychain namespace or verified provider-supported private storage. Redis caches safe metadata and progress, never the only persisted copy. Browser Zustand owns transient form state only; TanStack Query owns remote metadata. Reopening the app must restore connections and policy configuration without re-entry.

For remote API-key entry, use an audited libsodium sealed-box implementation addressed to a paired Mac encryption key whose fingerprint was independently confirmed on that Mac and pinned for this owner/device. Authenticated enrollment creates a single-use challenge and an operation ID with a five-minute expiry. Encrypt `{ ownerId, deviceId, profileId, operationId, challenge, expiresAt, apiKey }` in the browser. The relay transports ciphertext to the authorized online Mac without logging or persisting request bodies. The Mac verifies the binding, freshness and single-use challenge before storing the key and emits only safe metadata. Sealed-box encryption does not authenticate the sender: owner authorization, pinned device identity and challenge checks remain mandatory. Unknown/unpinned device keys require local enrollment; never fall back to plaintext relay storage.

Keep import plaintext only in the temporary password input and encryption operation; clear the form afterward. Never put secrets in URLs, query caches, Zustand persistence, analytics, errors, shell arguments/history, traces, Redis, screenshots or source control. Local enrollment and device approval remain available when remote enrollment is unsupported. A disconnected Mac makes enrollment pending/unavailable rather than apparently successful. Logout/revoke cancels enrollment; delivery uncertainty is reconciled by its original operation ID before another write.

## Explicit fallback policy

Each owner/device has named, versioned policies. A conversation may select a policy or explicitly disable fallback; otherwise it inherits the user's default. Merely connecting an account does not enable automatic use. The rule editor supports **Off**, **Ask** and **Automatic** modes.

An enabled policy defines ordered source/destination edges with profile, allowed model/effort mapping and trigger. Example: `Claude subscription A → Claude subscription B → Codex subscription C → Claude API D`. Same-provider profile changes are supported only where the native adapter verifies isolated credentials and safe resume; otherwise create a linked execution with a checkpoint. Cross-provider changes always use the continuity coordinator. Preserve project changes, environment placement, completed work, queued unsent prompts and reading positions.

Rules explicitly authorize cross-provider context sharing, whether a paid API destination may be used and whether definitely unsent queue entries move to the destination. Queue entries stay on the source unless the saved rule explicitly enables their move. Saving an Automatic rule grants permission for its configured transitions without asking again on every exhaustion. API destinations require an explicit spending allowance; locally estimated spend and provider-enforced caps are labeled separately. An estimate is not a guaranteed hard cap on in-flight usage. Missing required cost/usage data pauses a budget-constrained transition rather than assuming zero usage.

Policies are acyclic, contain at most three automatic transitions per exhausted task, and never revisit an attempted profile or a known exhausted shared quota pool in one chain. Two keys for one project/organization may share limits; additional keys are not assumed to add capacity. Skip disabled, removed, incompatible, unauthenticated or confirmed exhausted destinations. Unknown/stale usage remains visible; one verified attempt may discover exhaustion, after which that pool is skipped. Unverified source identity or unresolved delivery blocks automatic inference.

Default trigger: an authoritative subscription-window, model-family or API-quota exhaustion event. A temporary request-rate throttle follows the provider's retry/reset guidance on the same connection; arbitrary HTTP 429, network failure, authentication failure, context overflow or assistant-written text is not proof of exhausted quota. Capability probes must establish which native event/error types are trustworthy. A model-family limit must not mark every unrelated model or profile exhausted.

## Transition, recovery and visibility

1. Record the typed quota event, scope, observed time and reset time when reported. Freeze the applicable policy version and source execution generation.
2. Pause the affected inference lane. Reconcile attempted commands and check active tools/subagents/writers. Wait for a provably stable source boundary; never kill the process or rerun completed external effects. Show the current step and a small spinner.
3. Select the next eligible edge. Create one immutable bounded checkpoint within the policy's approved context scope; if the scope or attachments require additional permission, pause for that decision. Reuse the durable handoff coordinator with separate create/seed IDs and an owner/conversation lock.
4. Activate the destination only after confirmed context delivery and an authoritative ready snapshot. Move definitely unsent queue entries through a journaled move only when the rule enables it; otherwise retain them visibly on the source. Attempted/unknown entries always keep their source identity. New input is routed only to the confirmed active destination. Other conversations continue independently.
5. Record source, destination, reason, time, quota scope and operation outcome in a safe visible event log. Show a compact notice such as “Claude limit reached. Continued with Codex · Personal subscription.” Failed/unknown operations preserve the source and expose reconciliation or manual selection; they do not retry inference blindly.

After a restart, recover policies, quota observations/cooldowns, removal tombstones, active transition phase and counters from durable storage. Duplicate events and simultaneous failures in one conversation cannot create additional targets. Multiple conversations sharing one quota pool share its cooldown; they retain separate handoff/command identities. The owner can disable a policy or remove a destination during preparation; recheck the latest policy/profile version before every external write. Already accepted effects are reconciled rather than rolled back optimistically.

When the original limit resets, mark the connection eligible only from fresh authoritative evidence or a single policy-controlled probe after the reported reset; do not assume a timer guarantees capacity. Default behavior keeps the current destination. Optional automatic return is a separate explicit policy setting, evaluated only between turns with no unresolved delivery and a fresh checkpoint when needed; never interrupt work or alternate repeatedly between profiles.

## Delivery and acceptance

Deliver manual account management and profile selection first, independently of fallback. Add read-only quota visibility next. Enable automatic fallback only after verified credential isolation and the continuity coordinator are available for that native source. Desktop profile control remains capability-gated; unsupported integrations display the reason and a managed CLI destination instead of claiming account switching works.

Acceptance must explicitly prove the two-OpenAI-subscription-account scenario above, persistent CRUD/defaults, two isolated same-provider connections, subscription→subscription, subscription→API and Claude↔Codex routing, per-conversation overrides, configured paid-use boundaries, shared quota pools, no route cycles, reset/return behavior, deletion/revoke races, restart recovery, single create/seed delivery, stable queues/bookmarks and two-owner isolation. All Storybook/screenshots use English synthetic connections; RU/EN product copy remains required. Live acceptance uses separately authorized disposable accounts and usage.

## Sources and remaining probes

Checked 2026-10-17:

- [OpenAI authentication](https://learn.chatgpt.com/docs/auth): subscription versus API sign-in and corresponding workspace/billing boundaries.
- [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits): organization/project/model shared limits, quota distinctions and retry/reset information.
- [Claude Code authentication](https://code.claude.com/docs/en/authentication): login/credential precedence and supported profile mechanisms.
- [Claude Code usage and cost management](https://code.claude.com/docs/en/costs): subscription/model usage windows, spend limits and distinct failure conditions.
- [Libsodium sealed boxes](https://libsodium.gitbook.io/doc/public-key_cryptography/sealed_boxes): recipient encryption; sender identity needs separate authentication.

The document defines requested behavior, not verified native capability. Before implementation, probe installed versions for account isolation, quota event/reset reporting, supported resume, credential removal and Desktop attribution using isolated synthetic peers; record unsupported cases explicitly.
