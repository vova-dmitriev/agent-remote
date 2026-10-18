# Account Management and Automatic Fallback Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for approved implementation; use superpowers:subagent-driven-development only if explicitly selected. Implementation was explicitly authorized by the user on 2026-10-18, including Luna high subagents. Live sign-in, paid usage and deployment remain separate actions. Never commit.

**Goal:** Persist connected subscription/API profiles, including at least two independently authenticated OpenAI/ChatGPT subscription accounts for Codex, manage them from a dedicated page, and continue work automatically through an explicitly configured fallback chain when quota is exhausted.

**Architecture:** Extend the existing proposed profile registry with durable owner-scoped lifecycle operations and device-encrypted credential enrollment. A typed quota monitor and versioned policy engine choose a destination; the continuity coordinator performs one recoverable handoff and queue move.

**Tech stack:** Existing TypeScript/Zod, PostgreSQL, local Mac storage/Keychain, Redis, React/Zustand/TanStack Query and isolated native adapters. Use an audited libsodium binding for sealed-box enrollment; do not implement cryptographic primitives.

**Spec:** [Account management and fallback](../specs/2026-10-17-profile-management-fallback-design.md). **Dependency:** [Cross-provider continuity Tasks 1–3](2026-10-17-cross-provider-continuity.md) for managed profiles; Tasks 4–6 for automatic context/queue transfer.

## Execution status — 2026-10-18

Tasks 1–2 have an integrated Codex management foundation: durable metadata and operations, isolated native configuration, subscription sign-in, encrypted API enrollment, a shared Accounts & keys page and recovery tests. Independent Claude account authentication, active-execution dependencies, offline queued removal and real-provider acceptance remain unfinished. Task 3 quota observations/rules, Task 4 automatic continuation and Task 5 full release acceptance remain pending. Profile-aware creation and durable handoff are dependencies, not completed capabilities.

## Global constraints

- Implementation is authorized; never commit or use real credentials/sessions in automated tests. Keep all secret values out of source, fixtures, logs, URLs, relay persistence and browser persistence.
- Owner/device/generation/version checks precede reads and every side effect. Named const objects and derived types define every state, action, trigger and error code.
- PostgreSQL/local journals are durable authorities; Redis is a cache. Logout/revoke clears UI and pending enrollment. Credential deletion requires acknowledged local completion.
- Automatic inference requires an enabled policy authorizing the destination, model, context sharing and paid API use. Follow native access policies; do not replace global logins or assume different keys have independent quotas.
- Preserve project/environment placement, queued files, exact command receipts and reading positions. No duplicate inference or external-effect replay. Frontend uses FSD, named props, static test IDs, RU/EN copy and interaction-only stories.

## Review focus

- A label selects a different account than the runtime actually uses: verify profile identity/isolation in Task 1 and reject mismatch in Task 4.
- An enrollment ciphertext is replayed, rerouted, logged or sent to a substituted device key: Task 2 pins recipient identity, expiry, challenge and redaction tests.
- Two keys share an exhausted quota, or a throttle/auth error is misclassified: Task 3 pins scoped observations and temporary-throttle behavior.
- Duplicate quota events, lost receipts or restart create multiple targets or move attempted prompts: Task 4 pins single-flight creation, seed/move recovery and unknown delivery.
- Removal, policy edits or reset happen during a handoff: Tasks 1, 4–5 pin tombstones, last-moment version checks and between-turn return behavior.

## Delivery order

A. Profile lifecycle and Accounts & keys page (Tasks 1–2), independently useful with manual selection.
B. Quota reporting and rule editor (Task 3), initially observe-only.
C. Automatic continuation, recovery and acceptance (Tasks 4–5), capability-gated by verified native source support.

### Task 1: Persistent profile lifecycle and default selection

**Files:** extend proposed `packages/protocol/src/execution-profile.ts`, `values/execution.ts` and daemon `profiles/{registry,credentials,service}.ts`; create server `profiles/{types,service,routes,repository}.ts`; add next unused ordered migration `apps/server/src/db/migrations/003_execution_profiles.sql` after continuity migration 002. Tests: `tests/profile-lifecycle.test.ts`, `tests/profile-ownership.test.ts`.

**Interfaces:** `listProfiles(ownerId, deviceId): Promise<ExecutionProfileSummary[]>`; `updateProfile(request: UpdateProfileRequest): Promise<ProfileOperation>`; `removeProfile(request: RemoveProfileRequest): Promise<ProfileOperation>`; `setDefaultProfile(request: SetDefaultProfileRequest): Promise<ProfileOperation>`. Define strict schemas and named `ProfileAction`, `ProfileLifecycleStatus`, `ProfileOperationPhase`; expose safe metadata only.

- [ ] Write RED tests for persistent list/rename/disable/default/reconnect/restart, foreign owner/device reads and mutations, conflicting credential precedence, stale versions, two simultaneously retained OpenAI subscription accounts with independently verified runtime identities and no global login replacement, same-provider independent profiles, removal during use and companion-offline removal.
- [ ] Implement owner/device-bound registry metadata and durable lifecycle IDs. Disable new use and invalidate dependent rules on removal; retain a tombstone until the companion acknowledges credential/runtime reference cleanup. Do not terminate user processes or claim provider revocation.
- [ ] Validate official isolated subscription sign-in and actual account attribution before enabling new prompts. Keep metadata discovery from reading another profile root; preserve unrelated native logins and profiles.
- [ ] Run `npx vitest run tests/profile-lifecycle.test.ts tests/profile-ownership.test.ts --maxWorkers=4`; require observed RED then GREEN, including two-owner and restart cases.

### Task 2: Secure enrollment and the Accounts & keys page

**Files:** create protocol `credential-enrollment.ts`; daemon `profiles/enrollment/{types,identity,challenge,decrypt,service}.ts`; server `profiles/enrollment/{types,routes,service}.ts`; frontend public APIs under `pages/accounts`, `features/manage-profile`, `features/enroll-profile`, `entities/execution-profile`, and `shared/api/execution-profiles.ts`. Extend existing routing and i18n. Tests: `tests/credential-enrollment.test.ts`, `tests/e2e/accounts-page.spec.ts`.

**Interfaces:** `beginEnrollment(request: BeginEnrollmentRequest): Promise<EnrollmentChallenge>`; `completeEnrollment(request: EncryptedEnrollmentRequest): Promise<ProfileOperation>`; `reconcileProfileOperation(operationId): Promise<ProfileOperation>`. Challenge contains owner/device/profile/operation IDs, a single-use nonce, pinned recipient public-key identity and expiry exactly five minutes after issuance. Authenticated requests carry ciphertext only after encryption.

- [ ] Write RED tests for a substituted/unpinned recipient, foreign device, replay, expiry, mutated ciphertext, unavailable Mac, lost acknowledgment, logout/revoke and secret absence from protocol responses, persistence, logs and browser caches. Use generated disposable keys only.
- [ ] Implement audited sealed-box encryption/decryption and pin verification, separate owner authorization and replay protection. Store the decrypted provider credential only on the Mac; clear temporary form state. Reject remote import without a verified paired key; offer local enrollment, never plaintext relay fallback.
- [ ] Implement the dedicated page and add/rename/check/reauthenticate/replace/disable/default/remove flows with mutation operation progress and dependency summaries. Queries must never retrieve stored secrets. Persist connections/defaults and reflect pending deletion accurately after reopening.
- [ ] Add English synthetic Storybook states for subscription/API, two named OpenAI subscription accounts with an active-account indicator, several accounts, unknown quota, offline, expired auth, pending enrollment/removal and foreign/revoked access; RU/EN dictionaries cover all new product copy. Run enrollment unit tests and `E2E_APP_PORT=4175 npx playwright test tests/e2e/accounts-page.spec.ts` to GREEN.

### Task 3: Typed quota observations and versioned fallback rules

**Files:** create protocol `profile-quota.ts`, `profile-routing.ts`, `values/profile-routing.ts`; daemon `profiles/quota/{types,claude,codex,scope,store}.ts` and `profiles/routing/{types,policy,eligibility,store}.ts`; server `profiles/routing/{types,repository,routes}.ts`; next ordered migration `004_profile_routing.sql`; frontend `features/configure-fallback`. Tests: `tests/profile-quota.test.ts`, `tests/profile-routing.test.ts`, `tests/e2e/fallback-policy.spec.ts`.

**Interfaces:** `observeQuota(event: NativeQuotaEvent): Promise<QuotaObservation>`; `saveFallbackPolicy(request: SaveFallbackPolicyRequest): Promise<FallbackPolicy>`; `chooseFallback(input: FallbackSelectionInput): FallbackSelection`. Types bind owner/device, source execution, observation time/freshness, quota pool/model scope, reset time when supplied, exact policy version, destination model/billing/context scope and explicit unsent-queue move choice.

- [ ] Write RED tests: genuine subscription/model/API exhaustion versus temporary 429, auth/network/context errors and assistant-written text; shared organization/project pools; absent/stale quota/reset data; Off/Ask/Automatic; no policy versus inherited default and explicit conversation override; cycles; disabled/removed destinations; API spending opt-in and missing budget data.
- [ ] Probe installed native adapters for authoritative error/event mappings and supported usage/reset data; document unknown capabilities. Implement scoped durable observations and cooldowns; temporary throttles honor provider backoff on the current profile. Do not infer precise capacity from different keys or timer expiry.
- [ ] Implement versioned ordered edges with explicit target profile/model/effort, context scope and paid-use allowance. Reject cycles and chains exceeding three automatic transitions per exhausted task; share quota-pool cooldowns while keeping conversation operations independent. Retain current destination after reset unless the user explicitly configures between-turn return.
- [ ] Implement rule editing/reordering, per-conversation override, usage freshness labels and safe transition-event history. Run both unit suites and the targeted browser scenario to GREEN; verify policies/defaults survive app and companion restarts.

### Task 4: Durable automatic continuation through the existing coordinator

**Files:** create daemon `profiles/fallback/{types,coordinator,journal,preflight,recovery}.ts`; extend continuity coordinator/journal, queue move and active-execution contracts from the parent plan. Extend server profile-operation/routing events and frontend transition presentation. Tests: `tests/profile-fallback.test.ts`, `tests/profile-fallback-recovery.test.ts`, `tests/profile-fallback-queue.test.ts`, `tests/codex-account-fallback.test.ts`.

**Interfaces:** `beginFallback(request: BeginFallbackRequest): Promise<FallbackOperation>`; `reconcileFallback(operationId): Promise<FallbackOperation>`. Persist the exhausted source/observation, frozen policy version, attempted profile/pool set, hop count, selected destination and child handoff/queue-move IDs. Resolve new input through the authoritative active execution, never an optimistic UI selection.

- [ ] Write `tests/codex-account-fallback.test.ts`: connect synthetic OpenAI subscription accounts A/B, persist/reopen them, choose A, configure Automatic A→B, emit authoritative A exhaustion and require B runtime identity plus one confirmed context delivery before activation. Verify no new login, no replacement of A, preserved project/bookmark/queue policy, duplicate-event recovery, both exhausted, shared-pool identity, and no unconfigured API fallback. Run `npx vitest run tests/codex-account-fallback.test.ts --maxWorkers=4` to observe RED before implementation and GREEN afterward.
- [ ] Write RED cases for duplicate quota events, two simultaneous conversations, source tools/subagents still writing, partial completed external effects, unresolved receipts, policy edits/removal/revoke, unavailable targets, bounded context/attachment scope and subscription→API without configured spending permission.
- [ ] Acquire an owner/conversation operation lock; validate observation, identity and current policy/profile fences before every write. Wait for a stable source boundary, build a checkpoint inside approved scope and delegate create/seed to the existing durable coordinator. Unsupported source isolation or uncertain writes pause automatic inference with a concrete reason.
- [ ] Activate only after confirmed context delivery and a ready destination snapshot. Journal moves of definitely unsent prompts and files only when the policy permits them; otherwise preserve visible source queue entries. Never retarget attempted IDs. Do not repeat completed tool effects. Persist eligibility failures and hop counters before trying another explicitly allowed edge; preserve independent conversations and the original execution/history.
- [ ] Inject lost acknowledgments/crashes around creation, seed, queue move and activation. Verify one target/seed/move, no blind unknown retry and no route loops after restart. Recheck policy/profile state after every await; deleting a destination must block the next unaccepted external write.
- [ ] Run all four tests to GREEN. Verify automatic return, when separately enabled, waits for a fresh eligible source and an idle stable boundary; default reset behavior leaves the current execution selected.

### Task 5: End-to-end acceptance and capability-gated rollout

**Files:** add `tests/e2e/profile-fallback.spec.ts`, `profile-fallback-recovery.spec.ts`; extend `docs/provider-profile-compatibility.md`, `docs/e2e-coverage.md`, README and synthetic screenshot fixtures only after implementation is accepted.

- [ ] Write browser scenarios for persistent CRUD/defaults/rules, two retained OpenAI accounts with manual selection and automatic Codex subscription A→B without another sign-in, Claude→Claude, Claude→Codex, subscription→subscription/API, both keep-source and move-unsent queue/file policies, restored bookmarks, status spinner/event notice, budget stop, deletion/revoke and reset without unwanted return. Drive deterministic native peers and typed quota events, not real exhausted accounts.
- [ ] Use separately authorized disposable profiles for native compatibility acceptance. Explicitly accept OpenAI subscription A→B with two separately authorized disposable accounts or controlled quota injection at the adapter boundary; never deliberately spend an account to exhaustion. Verify observed account, authentication mode, model, quota trigger and supported resume/handoff; never infer these from labels. Keep unsupported Desktop auto-switch capability disabled with a usable managed CLI alternative.
- [ ] Run `npm run security:check`, `npm run security:test`, `npm run lint:fix`, source/frontend formatting checks, `npm run typecheck`, `npm test -- --maxWorkers=4`, `npm run build`, `npm run test-storybook`, `E2E_APP_PORT=4175 npm run test:e2e`. Inspect results and obtain independent review; never commit.
- [ ] Release persistent management first, then quota visibility, then opt-in automatic policies only for verified native sources. Preserve pairing/public URL and perform read-only service health checks. No automatic sign-ins, purchases or paid usage occur merely because the management page is released.

## Planning result

The extension replaces the earlier exclusion of automatic quota fallback. Subsequent user approval authorizes implementation; live billing changes and native account sign-ins remain separate. The next implementation gate is verified isolated profiles and profile-aware creation; account management can ship before automatic cross-provider continuation.
