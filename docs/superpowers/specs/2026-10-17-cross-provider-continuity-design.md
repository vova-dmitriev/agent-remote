# Cross-provider continuity and execution profiles

Status: implementation started by explicit user instruction on 2026-10-17. The profile-management page, encrypted API enrollment, isolated Codex launch, bounded local checkpoints and server conversation/proof foundations are implemented. Production handoff wiring, Claude profile-aware execution and automatic fallback remain in progress; authenticated provider acceptance is still required.

## Goal and confirmed requirements

Continue one task across Claude and Codex, retain useful working context, and select the account, subscription or API credential that pays for each execution. The user explicitly confirmed support for both subscriptions and API keys, a dedicated connection-management page, persistent add/remove operations and user-defined automatic fallback when limits are exhausted.

A logical conversation contains linked native executions. Switching the selected execution restores its own history, draft and reading position. Continuing with another provider creates a linked execution with a reviewed context checkpoint. Native thread IDs remain provider-specific.

## Existing implementation

- `packages/protocol/src/schemas.ts`: creation supports an optional verified profile/model/effort selection; legacy provider/cwd creation is preserved.
- `apps/daemon/src/sessions/create-session.ts`: creates managed Claude Code or Codex CLI sessions.
- `apps/daemon/src/codex/launcher.ts`: profile-aware creation uses isolated credential/config roots, a scoped socket and verified account/model/effort. Legacy native creation remains available.
- Claude profile environment and API-key adapters exist, but profile-aware Claude execution is not enabled until its native isolation is established.
- `apps/daemon/src/sessions/launch-context.ts` and `restart-session.ts`: already preserve native Claude launch arguments and cmux context.
- Native history paging, attachment transport, command receipts, outbox editing, provider filtering and durable reading positions already exist.
- Local profile/checkpoint registries and server logical conversation/proof services exist. A production coordinator must connect their audited effects before handoff can be exposed as working.

## Product behavior

1. In a conversation, choose **Continue with Claude / Codex** or select an existing linked execution.
2. Choose a registered profile, available model and supported effort setting. Show account/workspace label, subscription versus API billing and authentication readiness.
3. Preview and edit the handoff: objective, decisions, constraints, completed work, pending work, selected messages and files, repository state and important test results.
4. The Mac checks source readiness, target authentication, project/environment compatibility and unresolved deliveries. Progress is shown while it prepares the target.
5. Once target creation and context delivery are confirmed, subsequent messages go to the selected execution. Source history remains available; returning to it restores its reading position. Viewing old history alone does not redirect new messages. Resuming an old execution uses its own native context; continuing the current task across providers creates a fresh linked execution with the latest reviewed checkpoint.

Selecting a profile chooses an already authorized account/workspace and billing mode. It does not purchase a subscription or combine provider quotas. Automatic replacement is permitted only by an enabled, persisted user rule selecting the destination profile/model and authorizing its billing and context-sharing scope; configuring a profile alone does not authorize fallback.

## Profiles and authentication

- A profile belongs to an owner and device and records provider, auth mode, stable label, account/workspace identity when reported, authentication status and supported execution capabilities.
- Add subscription profiles through official native login flows. Add API keys through a protected local Mac flow or the device-bound encrypted enrollment defined in the [connection-management design](2026-10-17-profile-management-fallback-design.md). The Mini App receives only safe metadata after enrollment; it cannot retrieve stored credentials.
- Credential references and runtime homes are local. Prefer macOS Keychain when its namespace can be isolated; otherwise use provider-supported private local storage with owner-only permissions. Validate isolation rather than assuming a different home path isolates every credential store.
- Each managed profile has its own runtime/configuration namespace. Codex managed app-server sockets, process locks and connection discovery are keyed by profile. Claude hooks and transcript readers must discover the corresponding profile roots.
- Build a per-process environment, removing conflicting credential sources before applying the selected profile. Do not overwrite the global login or replace the daemon's environment. Verify the resulting auth identity/mode before enabling prompts.
- API profiles use native Claude Code/Codex execution where supported; a second custom agent/tool engine is outside the first release.
- Desktop sources can export context and reconnect to their actual owning application. Arbitrary independent per-thread Desktop account selection remains unavailable until a supported, verified mechanism exists; managed CLI execution is the first target for explicit profiles.
- Show quota/reset/cost data only when an authenticated supported source provides it. Otherwise show unavailable information explicitly. API estimates and subscription limits remain separate.

## Context contract

A versioned local checkpoint records source execution/generation, an exact history watermark, repository revision and working-tree summary, selected message IDs, attachment hashes, task state, user constraints, coverage and size estimate. Its digest identifies the exact payload. Manual handoffs record explicit preview approval. Automatic handoffs record the enabled policy ID/version and approved context scope, rather than claiming the generated payload was individually reviewed. Context outside that scope pauses the transition.

Keep the original history accessible through bounded native paging. Build checkpoints incrementally on the Mac. Reuse existing structured summaries where available; optional generated summaries use the explicitly selected source profile and disclose that model usage. Provide a manual summary path.

Never load an entire large transcript into the Mini App or silently truncate the transfer. For a legacy session without a checkpoint, offer a bounded recent window plus editable task summary, clearly showing incomplete coverage; background indexing can improve it without blocking chat opening.

Preserve attachment content through authenticated owner-scoped manifests. Check availability, expiry, integrity and target input support before starting target inference. Unsupported images/files must be surfaced in the preview.

The transferable context consists of visible messages and explicit task/project state. Provider-internal reasoning, caches, active tool executions, outstanding approvals and question IDs do not transfer. Historical quoted instructions remain data; destination system/tool rules come from its own runtime. Do not copy provider-specific system wrappers into a new prompt as authority.

## Execution and recovery

- Source snapshots must represent a stable boundary. Default to waiting for the active turn/tools to finish; do not terminate or restart the source to hand off context.
- Block activation while an accepted/unknown write could still complete. A cancellation request is not proof that a process stopped.
- Keep unsent source queue entries on their source by default. An explicit move can create new target command IDs only for definitely unsent entries, retaining files and order. Already attempted IDs are never retargeted.
- Detect unmanaged native writers and active subagents before starting another writer in the same working tree. Offer waiting or a separate worktree with an explicit working-tree snapshot; never silently reset, stash or discard edits. Unknown writer state blocks automatic continuation. A separate worktree is offered only when Git and an existing HEAD support it and the chosen snapshot can preserve uncommitted/untracked work; never create a commit merely to enable handoff.
- Preserve supported project/cwd, executable/version and terminal/cmux placement. Map model/effort/tool settings through an explicit compatibility result. Destination permissions use their native policy; source skip-permission flags are not automatically translated across providers.
- One durable handoff operation has distinct stable IDs for target creation and context delivery, a frozen checkpoint digest and owner/device/source/profile fences. A lost acknowledgment becomes unknown and is reconciled before any further write.
- Activate the new execution only after both context delivery and a ready authoritative target snapshot. An empty created target is not successful continuity.
- Failure leaves the source selected. A partially created target remains discoverable for reconciliation; no silent duplicate session or destructive cleanup.

## Storage and UI

Local Mac storage owns profile credentials, execution environments, checkpoint bodies and history indexes. PostgreSQL stores owner-scoped conversation/execution links and handoff operation metadata. Redis caches metadata/progress; it is not the sole source of truth. Existing authorized history/attachment transport remains the content path.

The app-scoped Zustand store owns selection and draft UI. Remote profile, model and handoff metadata use TanStack Query plus ordered live updates. Reading bookmarks retain their source execution identity. Provider filtering includes linked executions without duplicating transcript content or changing last-message ordering.

Introduce a dedicated **Accounts & keys** page, profile picker, execution switcher and handoff preview features with named props and RU/EN copy. Persist profile lifecycle and routing policies across reconnects/restarts; implement the [connection-management and automatic-fallback design](2026-10-17-profile-management-fallback-design.md) as an explicit extension. Reuse current progress, receipt and queue presentation. Show failed/unknown/pending-auth states with a concrete next action.

## Delivery boundaries and acceptance

First ship profile-aware session creation. Then ship managed CLI handoffs in both directions. Then expose existing linked executions in one conversation and add verified Desktop-specific capabilities. Then deliver account management and user-configured quota fallback according to its [implementation plan](../plans/2026-10-17-profile-management-fallback.md), reusing the verified profile and handoff contracts. Automatic fallback is part of the requested scope; custom gateways and cloud-to-cloud migration remain outside this plan.

Acceptance: Claude subscription → Codex subscription → Claude API and Codex API → Claude subscription can continue a synthetic task with its decisions, selected files and project state; returning to a branch preserves its read position and draft. Separate owners/profiles never share credentials or writes. Double-click, restart, offline recovery and uncertain receipts never create a second target or replay the seed.

## Verified references and remaining probes

Checked 2026-10-17:

- [OpenAI authentication](https://learn.chatgpt.com/docs/auth): subscription/API sign-in, separate API billing, credential storage and workspace restrictions.
- [Claude Code authentication](https://code.claude.com/docs/en/authentication): subscription/Console flows, credential precedence and CLI versus Desktop differences.
- [Claude Code settings](https://code.claude.com/docs/en/settings): `CLAUDE_CONFIG_DIR` also changes history/settings locations.

Before implementation locks adapters, verify installed CLI versions with isolated synthetic profiles: credential/keychain isolation, actual account/model/quota reporting, native seed/resume behavior and Desktop account attribution. These are release gates, not assumed capabilities.
