# Cross-provider Continuity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for approved implementation; use superpowers:subagent-driven-development only if explicitly selected. Implementation was explicitly authorized by the user after the strict-validation baseline commit on 2026-10-17. Live account sign-ins and deployment remain separate; create commits only when explicitly requested.

**Goal:** Continue a logical conversation across Claude and Codex using an explicit subscription/API profile while preserving reviewed task and project context.

**Architecture:** Separate logical conversations, native executions, local credential profiles and immutable context checkpoints. A durable handoff coordinator creates a target, delivers one checkpoint and then changes the active execution after confirmed receipts.

**Tech Stack:** Existing TypeScript/Zod protocol, Node companion/native CLI adapters, PostgreSQL, Redis, React/Zustand/TanStack Query, Storybook, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-cross-provider-continuity-design.md`.

## Execution status — 2026-10-18

The user authorized implementation with `gpt-6-luna` at high reasoning effort, at most five agents total. The current harness permits four concurrent agents including the coordinator, so at most three workers run together. The user authorized commits on 2026-10-18. The reviewed foundation is committed as `2da6f44`; subsequent increments require staged-snapshot validation. Live sign-ins, paid inference, pushes and production deployment remain separate actions.

Contracts and the Codex account-management foundation are implemented and tested. The Task 2 credential/runtime foundations exist; authenticated live-provider compatibility remains unverified. Task 3 currently adds authoritative profile-aware Codex creation and the shared profile/model chooser. Claude API-key isolation is investigated and implemented only through supported native interfaces; independent subscription isolation must remain unavailable until established. Tasks 4–8 remain pending.

The latest pre-wave baseline passed full validation (1,012 tests across 224 files), 294 Storybook cases, nine account browser scenarios and the built-extension account-enrollment scenario. Checkboxes below retain acceptance scope; a preparatory API or synthetic peer is not authenticated native acceptance.

## Global constraints

- Use synthetic temporary runtimes during implementation checks. No real chat prompts, credential inspection/export or account changes in tests.
- Follow existing owner/device/generation/runtime fences, durable command IDs and unknown-write behavior. Commit reviewed increments only after the installed pre-commit hook validates the staged snapshot; never bypass hooks or push without explicit authorization.
- Stored credentials/checkpoint bodies stay local; profile queries expose opaque IDs and safe metadata. API-key enrollment is an explicit device-encrypted import, never a readback API; see the follow-up connection-management plan.
- All domain values use dedicated named const objects and derived types. Frontend follows FSD, named props, static test IDs, RU/EN copy, 200-line source files and six-file directories.
- No assertions in stories. No unconfigured billing fallback or global login replacement. Automatic fallback requires an enabled, persisted rule with explicit destination/billing/context scope; preserve bounded history, queue behavior and reading position.

## Review focus

- Credential precedence or shared keychain entries select the wrong account despite a correct profile label: pin this in Tasks 1–2.
- A source message/tool/subagent changes after preview, invalidating the approved context: pin this in Tasks 4–5.
- Create/seed acknowledgment is lost across restart and produces duplicate inference: pin this in Task 5.
- Unknown source receipts or queued files move to another target and are sent twice: pin this in Tasks 5–6.
- Legacy large histories, expired images and branch navigation silently lose context or jump to the end: pin this in Tasks 4, 6–7.

## Delivery order

A. Profiles and profile-aware new sessions (Tasks 1–3), independently releasable.
B. Context checkpoints and managed CLI handoff (Tasks 4–5), behind a capability flag.
C. Queue/navigation UX, compatibility acceptance and rollout (Tasks 6–8).
D. Durable Accounts & keys management and user-defined quota fallback: [follow-up implementation plan](2026-10-17-profile-management-fallback.md), dependent on the profile and handoff contracts above.

### Task 1: Compatibility contract and domain schemas

**Files:** create `docs/provider-profile-compatibility.md`, `packages/protocol/src/execution-profile.ts`, `conversation.ts`, `context-checkpoint.ts`, `handoff.ts`, `values/execution.ts`; modify protocol exports and `schemas.ts`. Test: `tests/execution-profile-protocol.test.ts`.

**Interfaces:** define `ExecutionProfileSummary`, `ExecutionCapabilities`, `Conversation`, `ExecutionLink`, `ContextCheckpointSummary`, `CheckpointApproval`, `HandoffRequest`, `HandoffOperation` and strict schemas. Profiles expose only safe metadata. Checkpoint bodies are local and addressed by ID/digest.

- [x] Probe installed Claude/Codex in isolated temporary roots without reading existing credentials: profile-root isolation, official login paths, auth-mode/identity checks, model discovery, seed delivery, Desktop ownership limits. Record supported/unsupported/unknown per runtime and version.
- [x] Write failing schema tests: reject secret fields, foreign provider/profile pairing, invalid model/effort combinations and arbitrary executable/environment inputs; preserve existing create-session payloads when new options are omitted.
- [x] Add named `ProfileAuthMode`, `ProfileStatus`, `HandoffPhase`, `ExecutionMode` and error codes. Phases include preparing, awaiting source/auth, creating target, delivering context, ready, failed and unknown.
- [x] Run `npx vitest run tests/execution-profile-protocol.test.ts --maxWorkers=4`; require observed RED before implementing and GREEN afterward.

**Verification:** 20 contract tests passed after observed RED; `npm run validate` passed with 652 tests across 154 files plus 8 hook/security regressions, typecheck and all guarded-build quality gates. Native authenticated capabilities remain explicitly unverified in `docs/provider-profile-compatibility.md`. The create-session wire extension is deferred to Task 3 so selection cannot be accepted before its launcher honors it.

### Task 2: Local execution profiles and authenticated metadata

**Files:** create `apps/daemon/src/profiles/{types,registry,credentials,environment,capabilities,service}.ts`; modify local setup/IPC and main registration. Test: `tests/execution-profiles.test.ts`, `tests/profile-environment.test.ts`.

**Interfaces:** `ProfileRegistry.get(profileId): Promise<LocalExecutionProfile>`; `listProfileSummaries(): Promise<ExecutionProfileSummary[]>`; `buildProfileEnvironment(profileId, launch): Promise<NodeJS.ProcessEnv>`. Credential handles never serialize into summaries.

- [ ] Write RED tests for owner/device isolation, same-email distinct workspaces, expired/revoked profiles and a conflicting inherited API key overriding a subscription. A profile mismatch must disable execution rather than change billing.
- [ ] Implement private profile storage and official native login onboarding. Keep credential import absent from shell history/logs; the separate connection-management plan adds device-encrypted entry through the Mini App. Never expose stored keys back to the browser. Verify identity/mode after login and refresh.
- [ ] Build explicit environment overlays and provider-specific runtime homes. Reject unknown credential/config precedence that cannot be isolated; preserve non-secret required project/cmux settings through validated launch plans.
- [ ] Run both tests to GREEN; verify two synthetic profiles can coexist without replacing each other's store, socket, auth state or configuration. Report quota/model data only from supported verified sources.

### Task 3: Create sessions with a chosen profile/model

**Files:** modify `apps/daemon/src/sessions/{create-session,launcher,launch-context}.ts`, `code/pty-session-manager.ts`, `codex/{launcher,manager}.ts`, command dispatch and protocol create action. Create `sessions/execution-launch-plan.ts`; extend existing creation/native-launch tests.

**Interfaces:** `ExecutionLaunchSelection { profileId, provider, model, effort? }`; `createManagedExecution(project, selection): Promise<ExecutionLink>`. Use one Codex managed socket/lock namespace per profile; source session identity remains separate.

- [ ] Write RED tests: two profiles launch into different credential/runtime namespaces; only registry-backed profiles and validated cwd/model combinations are accepted; absent new fields keeps current creation behavior.
- [ ] Thread selection through existing audited creation. Spawn with explicit profile environment, retain cmux/terminal context and validate native ready snapshot identity before returning success.
- [ ] Prevent default discovery from attaching one profile's thread to another profile. Preserve same-provider restart parameters where supported; return an explicit compatibility result for unsupported cross-provider flags.
- [ ] Run launch/profile/creation tests to GREEN. Deliverable: profile-aware new Claude/Codex sessions without context transfer.

### Task 4: Immutable, bounded context checkpoints

**Files:** create `apps/daemon/src/continuity/context/{types,checkpoint,collector,coverage,attachments,summary}.ts`; reuse `code/transcript-{window,pages}.ts`, native Codex history readers and `attachments/history.ts`. Test: `tests/context-checkpoint.test.ts`, `tests/context-checkpoint-large-history.test.ts`.

**Interfaces:** `prepareCheckpoint(source, selection): Promise<ContextCheckpointSummary>`; `finalizeCheckpoint(id, editedSummary, approval: CheckpointApproval): Promise<ContextCheckpointSummary>`; `readCheckpoint(id, expectedDigest): Promise<LocalContextCheckpoint>`.

- [ ] Write RED tests for exact message watermark, selected attachments, explicit decisions/tasks, same-file edits, changed source generation and stale preview. No provider tool-call/question IDs or system wrapper instructions may become destination authority.
- [ ] Implement immutable local manifests, digest and attachment checks. Record manual preview approval or the enabled policy ID/version and context scope; reject automatic payloads that exceed that scope. Use incremental indexes and existing summaries; expose coverage and estimated input size before sending. A generated summary requires an explicit profile and is tracked as usage; manual summaries work without inference.
- [ ] Add a large synthetic transcript test: initial preview reads bounded windows and does not load the whole file into browser/server memory. Missing older coverage and unsupported/expired files must remain visible, never silently omitted.
- [ ] Run both tests to GREEN. A saved checkpoint is reviewable, versioned and invalidated when its captured project/source boundary changes before execution.

### Task 5: Durable conversation links and handoff coordinator

**Files:** create `apps/daemon/src/continuity/{types,coordinator,journal,preflight,seed,reconcile}.ts`; create `apps/server/src/continuity/{types,service,routes,repository}.ts`; add migration `apps/server/src/db/migrations/002_continuity.sql` and extend `db/database.ts` migration loading. Modify relay/main/dispatch registration. Test: `tests/handoff-coordinator.test.ts`, `tests/handoff-recovery.test.ts`, `tests/conversation-ownership.test.ts`.

**Interfaces:** `startHandoff(request: HandoffRequest): Promise<HandoffOperation>`; `getHandoff(operationId): Promise<HandoffOperation>`; `reconcileHandoff(operationId): Promise<HandoffOperation>`; `activateExecution(conversationId, executionId, expectedVersion): Promise<Conversation>`.

- [ ] Write RED tests for Claude→Codex and reverse using controlled native peers; busy source/tools/subagents wait for a stable boundary, unsupported or foreign profiles fail before creating a target.
- [ ] Store owner-scoped conversation/execution links and versioned operation metadata in PostgreSQL; keep checkpoints/local journal on the Mac and cache progress in Redis. Add ordered additive migrations with a schema-migration journal and a tested upgrade from the current legacy database; do not edit the initial migration to add new tables.
- [ ] Freeze checkpoint digest and source/profile fences. Derive separate stable create/seed IDs from the operation and persist each phase before its side effect. Acquire a conversation operation lock; recheck file/source/auth readiness after await boundaries.
- [ ] Create target and deliver checkpoint through existing native prompt/attachment adapters. Switch active execution only after confirmed seed dispatch and a ready authoritative snapshot. Never kill the source or replay a copied tool transcript.
- [ ] Inject crashes/lost acknowledgments before and after every write. Require one target and one seed, no automatic unknown-write retry, and a discoverable partially created target after restart. Source remains selected on failure.
- [ ] Verify ownership checks precede cache reads and content access; normal creation, old database upgrades, revoke/cascade and concurrent handoff attempts remain correct. Run all three tests to GREEN.

### Task 6: Queues, project writers and branch history

**Files:** extend daemon continuity preflight; modify Mini App entity/session store, outbox model and reading-position mapping; create `apps/server/src/continuity/history.ts`. Test: `tests/handoff-queue.test.ts`, `tests/conversation-history.test.ts`, `tests/handoff-project-writers.test.ts`.

**Interfaces:** `moveUnsentPrompts(sourceExecutionId, targetExecutionId, commandIds, expectedVersion)` creates new target intents only after explicit selection; attempted command IDs retain their original source. History items retain `{ executionId, nativeMessageId }` identity.

- [ ] Write RED tests: accepted/unknown/sending commands cannot move; definitely unsent edited text/files move once with new IDs and preserved order; reconnect or cancellation cannot resurrect the source queue entry.
- [ ] Check active native writers/subagents before a second execution writes to the same tree. Waiting is default; separate-worktree continuation requires explicit snapshot handling. Unknown native writer state blocks automatic continuation; do not stash/reset/discard edits. Disable the worktree option without a valid HEAD or a lossless approved snapshot; never create a commit to manufacture one.
- [ ] Preserve per-execution drafts and message+offset bookmarks. Linked history uses existing bounded paging and source labels, with no duplicate messages or mark-all-read jump on activation.
- [ ] Run tests to GREEN, including source updates during transfer and unavailable/expired file content. Keep native source histories intact and recoverable.

### Task 7: Mini App profile chooser and continuation flow

**Files:** create explicit public APIs in `entities/execution-profile`, `entities/conversation`, `features/select-execution`, `features/continue-session`; add `shared/api/{execution-profiles,continuity}.ts`; extend sessions/session pages, i18n and app-scoped store. Colocate named props, static test IDs and synthetic stories. Test: `tests/e2e/provider-continuity.spec.ts`, `profile-selection.spec.ts`, `continuity-recovery.spec.ts`.

**Interfaces:** profile/model queries return safe capability metadata; continuation mutation returns an operation ID. UI observes operation progress and changes the active execution only on the authoritative completion contract from Task 5. History viewing is separate from the active input destination; continuing current context creates a fresh linked execution, while explicit old-branch resume retains that branch context.

- [ ] Write RED browser scenarios for choosing subscription/API profiles, provider/model/effort, editing the context preview, waiting for source/auth, successful continuation and selecting an older linked execution.
- [ ] Implement profile label and billing indicator, unavailable-model explanation, explicit context coverage, progress spinner and failed/unknown recovery actions. Never label an unsupported Desktop profile selector as working.
- [ ] Preserve All/Claude/Codex filtering on navigation, reading position, draft attachments and queue edits. Sign-out/revoke clears owner UI; reload recovers operation metadata instead of creating another target.
- [ ] Add Storybook visual states for every phase, mobile/short viewport and RU/EN. Stories contain interactions only. Assert behavior and metadata through static test IDs in E2E; require GREEN.

### Task 8: Acceptance and staged rollout

**Files:** extend `docs/provider-profile-compatibility.md`, `docs/e2e-coverage.md` and user-facing continuity instructions; add synthetic native acceptance helpers under tests/tools using existing conventions.

- [ ] Run native acceptance with disposable authenticated profiles after the owner authorizes those test sign-ins/usages: both provider directions, subscription→API and API→subscription. Verify the observed account/model and receiving attachment content; do not infer this from labels or fake peers.
- [ ] Run `npm run lint:fix`, formatting checks, `npm run typecheck`, `npm test -- --maxWorkers=4`, `npm run build`, `npm run test-storybook`, `E2E_APP_PORT=4175 npm run test:e2e`; inspect failures and obtain independent review.
- [ ] Roll out profile-aware creation first, then explicit managed CLI handoff behind a capability flag. Keep Desktop-specific features disabled until separately accepted. Package and verify the archive, preserve the public URL/pairing and run read-only live health/contract checks.
- [ ] Acceptance must prove context continuity, account/billing selection, no duplicate inference on recovery and stable navigation; a new empty target or an optimistic UI toast is insufficient.

## Planning conclusions

The recommended implementation is native-runtime continuation with a shared conversation/context layer. Rewriting transcript files to impersonate another provider is rejected because identities, tool protocols and account ownership differ. Building a separate API-based agent engine is postponed because existing CLIs can retain their own tool and permission behavior.

The main uncertainty is authenticated profile isolation and identity reporting for the installed runtimes, especially Desktop. Task 1 resolves it before committing to UI capabilities. No production code, credentials, runtime configuration or live sessions are changed by this plan.
