# Architecture Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, selected by the user on 2026-10-19, at most 5 concurrently running subagents. Steps use checkbox (`- [ ]`) syntax for tracking. The user authorized commits on 2026-10-19: every "Checkpoint" step ends with a commit through the installed pre-commit hook (`validate:commit`); never use `--no-verify`. Never push. The user approved the AGENTS.md vocabulary-location change in Task 4.

**Goal:** Fix five review findings (deep relative imports, numeric HTTP statuses, a NestJS shell around raw Express, flat "dump" directories, a broken `npm run package:desktop`) and every finding of the 2026-10-19 architecture review (Tasks 13–22).

**Architecture:** One alias vocabulary (`@protocol`, `@protocol/private`, `@transport/*`) for every app, resolved by TypeScript `paths`, Vite/Vitest aliases, esbuild/tsx tsconfig discovery, and a post-`tsc` specifier rewrite for the Node `dist/`. HTTP status is derived from the error code through one table; no numeric literals at call sites. The relay becomes real Nest modules (controllers, guard, exception filter, injectable WebSocket hub) behind the unchanged `createRelay()` facade, so every existing HTTP/WS test keeps running unmodified. A source-structure gate (≤6 files per directory) covers backend and packages like the existing frontend gate.

**Tech Stack:** TypeScript 5.9.3, Node ≥22.12, NestJS 12.1.3 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`), `ws` 8.22, Zod 4, Vitest 5.0.5 (rolldown/oxc transform), tsx 4.23, esbuild 0.28, Vite 8, PostgreSQL via `compose.test.yml`.

**Spec:** This plan implements the user review of 2026-10-19 (five findings, quoted in the conversation) against [Telegram + cmux design](../specs/2026-10-16-telegram-cmux-design.md) ("NestJS + ws", "pnpm workspaces") and AGENTS.md ("named `as const` objects … do not duplicate inline … domain literals").

## Measured baseline (2026-10-19)

| Fact | Value | How measured |
|---|---|---|
| Relative imports into `packages/*/src` | 536 (daemon 212, server 60, extension 23, desktop 13, tests/scripts rest) | grep `from '(\.\./)+packages/` |
| `@protocol` alias uses in mini-app | 224 (+4 `@transport`) | grep |
| `new Fault(...)`/`ContinuityError` sites in `apps/server/src` | 188 | TypeScript AST scan |
| Directories with >6 source files (backend + packages) | 14 | find |
| `package:desktop` blockers | 53 ESLint errors (18 uncommitted files), 17 Prettier files, 2 knip exports, 4 `tsc` errors | ran each gate |
| Full test suite | 1187 passed, 2 files failed: `packaged-companion` (same `tsc` errors), `local-companion-supervisor` (fails under `--maxWorkers=4`, passes 3/3 alone) | `vitest run --maxWorkers=4` |
| Nest decorators | work under Vitest, `tsc`+node and tsx **only** with `experimentalDecorators: true` and explicit `@Inject(Token)`; parameter decorators fail to parse without it | spike in `tests/zz-spike` (deleted) |

## Global Constraints

- Node `>=22.12.0`; TypeScript `5.9.3`; NestJS `12.1.3`; no new runtime dependency. `express` leaves `dependencies` (Nest's own `express@5.2.1` stays transitive); `@types/express` stays in devDependencies for `Request`/`Response` types.
- Nest DI: never rely on `emitDecoratorMetadata` (oxc/esbuild cannot emit it). Every constructor parameter of a Nest-managed class uses `@Inject(Token)`. Plain domain services (`DeviceService`, `AuthService`, …) stay undecorated and are registered with `useFactory`.
- Every owned status, code, reason and method is an `as const` object with a derived union (AGENTS.md). Shared wire vocabulary lives in `packages/protocol/src/<domain>/*values.ts` after Task 4 (AGENTS.md line updated in Task 4).
- Ownership checks stay on every data and command path; no route loses its `principal`/device authentication.
- Wire compatibility: every HTTP path, method, status code, JSON body `{ code }`, header (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Next-Cursor`, `X-After-Cursor`, `X-Attachment-Cache-Hit`, `Set-Cookie`) and WebSocket close code/reason stays byte-identical, except where a task names the change.
- Structure: ≤6 source files per directory (excluding `index.ts`) under `apps/daemon/src`, `apps/server/src`, `apps/desktop/src`, `apps/chrome-extension/src`, `packages/*/src`.
- `npm run validate` must pass at the end of every task. `npm run package:desktop` must pass at the end of Task 1 and Task 12.
- Never store secrets, tokens, real chat content or recordings; tests use synthetic Telegram identities only.

## Review Focus

1. **JSON-typed attachment upload.** An attachment POSTed with `Content-Type: application/json` must be stored byte-for-byte; a global JSON body parser in Nest would consume it first. Test owned by Task 11.
2. **Malformed or oversized JSON body** on a JSON route (`PATCH /preferences` with `{` or a 129 KB body) must return the same status and body as before the Nest migration. Characterization test owned by Task 8.
3. **Running from `dist/` without TypeScript tooling** (Docker image, packaged companion, `apps/daemon/bin/remote.mjs`) must resolve every alias. Test owned by Task 3.
4. **Logout while sockets are open** must still close every app socket of the revoked token with `4001 UNAUTHORIZED` after the WebSocket code moves into an injectable hub. Covered by the existing `tests/relay-ws.test.ts`; Task 10 adds the explicit case if missing.
5. **Relay shutdown** (`close()`) must terminate sockets, stop intervals and drain the device fence in the same order; a leaked interval keeps Vitest workers alive. Test owned by Task 10.

---

### Task 1: Make `package:desktop` green

**Files:**
- Modify (lint/format only, no behavior change): the 18 files listed by `npm run lint:source`, including `apps/daemon/src/profiles/quota/{codex-observation,service}.ts`, `apps/daemon/src/profiles/runtime/native.ts`, `apps/server/src/continuity/services/transitions.ts`, `apps/server/src/profiles/routing/{repository,service}.ts`, `packages/protocol/src/profile-routing.ts`, `packages/transport/src/{profile-client,profile-routing-client}.ts`, `tests/{continuity-access-protocol,continuity-target-lease,handoff-start-protocol,profile-quota-contract,profile-quota-runtime,profile-routing-client,profile-routing-contract,profile-routing-storage}.test.ts`
- Modify: `apps/mini-app/src/pages/accounts/lib/management/operation-journal.ts:33,36`, `apps/mini-app/src/pages/accounts/model/management/use-profile-management.ts:38,47`
- Modify: `apps/mini-app/src/entities/execution-profile/index.ts:5`, `apps/mini-app/src/features/create-session/model/profile-launch.ts:2`

**Interfaces:** none produced.

- [ ] **Step 1: Auto-fix lint and format**

Run: `npm run lint:source:fix && node_modules/.bin/prettier --write $(npm run -s format:source:check 2>&1 | sed -n 's/^\[warn\] \(.*\.[tj]s\)$/\1/p')`
Expected: `npm run lint:source` reports only the 6 manual errors (`no-nested-ternary`, `curly`).

- [ ] **Step 2: Fix the remaining `no-nested-ternary` and `curly` errors by hand**

Replace each nested ternary with an `if`/early-return or a lookup object keyed by an existing `as const` value. Add braces for `curly`.
Run: `npm run lint:source`
Expected: exit 0.

- [ ] **Step 3: Fix the 4 `TS18047 'response.data' is possibly 'null'` errors**

At each site, branch on `response.data === null` and handle it the same way the surrounding code handles a failed response (throw the existing error code used two lines below, or return early). Do not use a non-null assertion.
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json`
Expected: exit 0, no output.

- [ ] **Step 4: Remove the duplicate `ProfileLaunchResolution` type export flagged by knip**

Keep the type in `apps/mini-app/src/entities/execution-profile/model/profile-launch.types.ts`; drop the unused re-export lines.
Run: `npm run knip`
Expected: exit 0.

- [ ] **Step 5: Run the full packaging chain**

Run: `npm run package:desktop`
Expected: exit 0; `apps/desktop/out/` contains the packaged app. If a later stage fails (desktop build, package, make), stop and report the first error verbatim; it was never reached before this task.

- [ ] **Step 6: Checkpoint**

The working tree holds pre-existing uncommitted feature work (profile quota/routing, continuity access; 68 paths). The user authorized committing it; it cannot be committed separately because it does not pass the hook without this task's fixes. Stage everything (`git add -A`, after confirming `git status` shows no secrets, `.env`, recordings or build output) and commit once: `feat: profile quota and routing groundwork; make packaging gates pass`. If the hook's `npm test` step fails only on `tests/local-companion-supervisor.test.ts`, run that file alone; if it passes alone, record it and fold the Task 2 fix into this commit instead of bypassing the hook.

---

### Task 2: Stabilize `local-companion-supervisor` under parallel load

**Files:**
- Modify: `tests/local-companion-supervisor.test.ts:120-140` (test "keeps the synthetic child alive after its launching parent exits")
- Possibly modify: the supervisor source the test exercises (`apps/daemon/src/local/supervisor/ensure.ts`) only if the root cause is in production code.

**Interfaces:** none.

- [ ] **Step 1: Reproduce under load**

Run: `for i in 1 2 3 4 5; do node node_modules/vitest/vitest.mjs run --maxWorkers=4 tests/local-companion-supervisor.test.ts tests/packaged-companion.test.ts tests/relay-ws.test.ts | grep -E "Tests "; done`
Expected: at least one run fails with `ENOENT … /pulse` at line 136. If it never fails, run the full suite with `--maxWorkers=4` twice and record the result.

- [ ] **Step 2: Confirm the suspected cause with superpowers:systematic-debugging**

Suspected (from code reading, not yet proven): line 136 reads `pulse` with a bare `readFile` right after the parent exits, while the neighbouring test at lines 121-124 waits for the same file with the existing `waitForFixture` helper (imported at line 13). Under load the detached child has not written its first pulse yet. Prove it: log the time the child writes `pulse` and the time of the read in one failing run.

- [ ] **Step 3: Fix**

If confirmed: replace `await readFile(join(directory, 'pulse'), 'utf8')` at line 136 with `await waitForFixture(join(directory, 'pulse'))`; keep the following "pulse advances" assertion unchanged. If the child actually died, fix the supervisor instead. Never delete or weaken an assertion.

- [ ] **Step 4: Verify**

Run Step 1's loop.
Expected: 5/5 runs pass.

(Update 2026-10-19: Steps 2–3 were already applied inside Task 1's commit `4dff7ad`; only Step 1/4 verification remains for the flaky test.)

- [ ] **Step 4b: Tolerate Finder metadata in the desktop runtime**

Observed in Task 1: `npm run package:desktop` failed once with `LOCAL_RUNTIME_UNTRUSTED` because Finder created `.DS_Store` inside `apps/desktop/dist/desktop-companion` during the run; `listRuntimeFiles` (`scripts/desktop/runtime-files.mjs`) rejects any undeclared file. The same check runs on installed apps, so a user opening the bundle's resources in Finder would brick the companion. Fix: `listRuntimeFiles` skips regular, non-symlink files whose name is exactly `.DS_Store` (named constant `FINDER_METADATA = '.DS_Store'`), at any depth; ownership/mode checks still apply to them. Check `apps/daemon/src/local/supervisor/runtime.ts` (`verifyCompanionRuntime`) for the same undeclared-file rule and apply the same exemption there if it exists. Test first: a runtime fixture with `.DS_Store` at root and in a subdirectory verifies; a `.DS_Store` symlink or a `.DS_Store` directory is still rejected; any other undeclared file is still rejected.

- [ ] **Step 5: Checkpoint** — commit `fix: tolerate Finder metadata in verified desktop runtime` through the hook.

---

### Task 3: One alias vocabulary everywhere

**Files:**
- Modify: `tsconfig.json` (paths), `vitest.config.ts`, `apps/mini-app/vite.config.ts`, `apps/mini-app/tsconfig.json` (add `@protocol/private`)
- Create: `scripts/build/node.mjs` (tsc emit + alias rewrite), `scripts/build/rewrite-aliases.mjs`
- Modify: `scripts/build.mjs` (call `buildNode()`), `tests/helpers/packaged-companion.ts` (call `buildNode()` instead of raw `tsc`)
- Modify: `packages/protocol/src/values/index.ts` (export `local-control.ts`)
- Modify: every file with a relative import into `packages/*/src` (≈536 sites in `apps/`, `tests/`, `scripts/`)
- Modify: `apps/daemon/eslint.config.mjs` (`no-restricted-imports`), `apps/mini-app/eslint.config.mjs` (same rule)
- Test: `tests/build-aliases.test.ts`, `tests/domain-value-lint.test.ts`

**Interfaces:**
- Produces: specifiers `@protocol` → `packages/protocol/src/index.ts`; `@protocol/private` → `packages/protocol/src/private-error-codes.ts`; `@transport/*` → `packages/transport/src/*`.
- Produces: `rewriteAliases(code: string, file: string, distRoot: string): string` in `scripts/build/rewrite-aliases.mjs`; `buildNode(): Promise<void>` in `scripts/build/node.mjs` (runs `tsc -p tsconfig.build.json`, then rewrites every `dist/**/*.js` and `dist/**/*.d.ts`, excluding `dist/mini-app`).

- [ ] **Step 1: Write failing unit tests for the rewrite**

```ts
// tests/build-aliases.test.ts
import { rewriteAliases } from '../scripts/build/rewrite-aliases.mjs';
const dist = '/repo/dist';
it('rewrites @protocol to the emitted index', () => {
  expect(rewriteAliases("import { ErrorCode } from '@protocol';", '/repo/dist/apps/server/src/auth/security.js', dist))
    .toBe("import { ErrorCode } from '../../../../packages/protocol/src/index.js';");
});
it('rewrites @protocol/private and @transport subpaths', () => {
  const out = rewriteAliases(
    "export { X } from '@protocol/private';\nimport { y } from '@transport/native/fragments.js';",
    '/repo/dist/apps/daemon/src/main.js', dist);
  expect(out).toContain("'../../../packages/protocol/src/private-error-codes.js'");
  expect(out).toContain("'../../../packages/transport/src/native/fragments.js'");
});
it('rewrites dynamic and type-position imports', () => {
  expect(rewriteAliases("const m = await import('@protocol');", '/repo/dist/x.js', dist))
    .toBe("const m = await import('./packages/protocol/src/index.js');");
  expect(rewriteAliases("q: import('@protocol').UserInputQuestion[]", '/repo/dist/x.d.ts', dist))
    .toContain("import('./packages/protocol/src/index.js')");
});
it('leaves other specifiers alone', () => {
  const src = "import x from '@nestjs/core'; import y from './protocol.js';";
  expect(rewriteAliases(src, '/repo/dist/x.js', dist)).toBe(src);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node node_modules/vitest/vitest.mjs run tests/build-aliases.test.ts`
Expected: FAIL, module `scripts/build/rewrite-aliases.mjs` not found.

- [ ] **Step 3: Implement `rewriteAliases` and `buildNode`**

Match quoted specifiers after `from`, `import(` and bare `import` with `/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(@protocol(?:\/private)?|@transport\/[^'"]+)\2/g`. Compute the relative path with `path.relative(dirname(file), target)` and prefix `./` when it does not start with `.`. `@transport/x.js` keeps its extension; `@transport/x` without extension gets `.js`. `buildNode` walks `dist/` with `fs.readdirSync(…, { recursive: true })`.

- [ ] **Step 4: Run the unit tests**

Expected: PASS (4 tests).

- [ ] **Step 5: Add the aliases to resolvers**

`tsconfig.json` paths: keep `@protocol`, `@transport/*`; add `"@protocol/private": ["./packages/protocol/src/private-error-codes.ts"]` **before** `@protocol`. Same entry in `apps/mini-app/tsconfig.json`. In `vitest.config.ts` and `apps/mini-app/vite.config.ts` turn `alias` into an array with `{ find: '@protocol/private', replacement: … }` first, then `{ find: /^@protocol$/, replacement: …/index.ts }`, then `@transport`. esbuild (desktop main/preload) and tsx read root `tsconfig.json` paths without changes.

- [ ] **Step 6: Codemod the relative imports**

Run once (not committed):
```bash
git ls-files 'apps/**/*.ts' 'apps/**/*.tsx' 'apps/**/*.mjs' 'tests/**/*.ts' 'scripts/**/*.ts' 'scripts/**/*.mjs' | grep -v '^apps/mini-app/' | xargs perl -pi -e "
  s#(['\"])(?:\.\./)+packages/protocol/src/private-error-codes\.js\1#\1\@protocol/private\1#g;
  s#(['\"])(?:\.\./)+packages/protocol/src/[^'\"]+\.js\1#\1\@protocol\1#g;
  s#(['\"])(?:\.\./)+packages/transport/src/([^'\"]+)\1#\1\@transport/\2\1#g;"
```
Do **not** touch the string paths into `dist/packages/...` in `scripts/desktop/*.mjs` and `scripts/extension/*.mjs`; they address build output, not source. Do not touch `apps/mini-app/vite.config.ts` URLs.

- [ ] **Step 7: Merge duplicated import lines and fix collisions**

Run: `npm run lint:source:fix && node node_modules/typescript/bin/tsc --noEmit`
Expected: exit 0. A name exported by two protocol modules shows up as `TS2308`; resolve by renaming the non-public one, never by importing a deep path.

- [ ] **Step 8: Switch build callers to `buildNode()`**

`scripts/build.mjs` replaces its `execFileSync(tsc)` call with `await buildNode()`. `tests/helpers/packaged-companion.ts` does the same.

- [ ] **Step 9: Prove `dist/` runs with plain Node**

Add to `tests/build-aliases.test.ts` (integration, `timeout: 180_000`): run `buildNode()`, assert no file under `dist/apps` or `dist/packages` contains `'@protocol` or `'@transport/`, then `execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./dist/apps/daemon/src/setup-cli.js'); await import('./dist/apps/server/src/relay.js')"])` exits 0.
Run: `node node_modules/vitest/vitest.mjs run tests/build-aliases.test.ts tests/packaged-companion.test.ts`
Expected: PASS.

- [ ] **Step 10: Lock it in with a lint rule (test first)**

Add a case to `tests/domain-value-lint.test.ts`: linting `import { ErrorCode } from '../../../../packages/protocol/src/index.js';` as `apps/daemon/src/example.ts` reports rule `no-restricted-imports`; linting `import { ErrorCode } from '@protocol';` reports nothing. Run, see it fail. Add to `nodeSourceConfig` rules and to the mini-app ESLint config:
`'no-restricted-imports': ['error', { patterns: [{ group: ['**/packages/*/src/**'], message: 'Import through @protocol, @protocol/private or @transport/*.' }] }]`. Run again: PASS.

- [ ] **Step 11: Checkpoint** — `npm run validate && npm run package:desktop && docker build -t agent-remote-alias-check .` all exit 0 (the Docker build ends with `node --check dist/apps/server/src/main.js`).

---

### Task 4: Restructure `packages/protocol/src` by domain

**Files (all `git mv`; `index.ts` re-exports keep the public API identical):**

| New directory | Files moved into it |
|---|---|
| `errors/` | `error-codes.ts`, `private-error-codes.ts`, `local-errors.ts`, `validation.ts` |
| `connection/` | `values/connection.ts` → `values.ts`, `values/http.ts` → `http.ts`, `values/host.ts` → `host.ts`, `values/local-control.ts` → `local-control.ts` |
| `session/` | `schemas.ts`, `values/session.ts` → `values.ts`, `values/command.ts` → `command-values.ts`, `activity.ts`, `subagents.ts`, `file-changes.ts` |
| `history/` | `history-window.ts`, `reading-position.ts`, `attachments.ts`, `values/history.ts` → `values.ts`, `preferences.ts`, `values/preferences.ts` → `preferences-values.ts` |
| `input/` | `user-input.ts`, `prompt-delivery.ts` |
| `execution/` | `execution-fields.ts`, `execution-profile.ts`, `conversation.ts`, `values/execution.ts` → `values.ts` |
| `continuity/` | `context-checkpoint.ts`, `handoff.ts`, `continuity-access.ts`, `values/continuity.ts` → `values.ts` |
| `profile/` | `profile-access.ts`, `profile-management.ts`, `profile-quota.ts`, `profile-routing.ts`, `values/profile-management.ts` → `management-values.ts`, `values/profile-routing.ts` → `routing-values.ts` |
| `credentials/` | `credential-enrollment.ts`, `values/credential-enrollment.ts` → `values.ts`, `profile-auth-url.ts`, `values/profile-auth-url.ts` → `auth-url-values.ts` |
| `local/` | `local-client.ts`, `local-limits.ts`, `desktop-bridge.ts`, `values/local-client.ts` → `client-values.ts`, `values/desktop-bridge.ts` → `bridge-values.ts` |

Delete `values/index.ts` and `values/`. Also modify: `packages/protocol/src/index.ts`, `tsconfig.json` + `apps/mini-app/tsconfig.json` + both alias configs (`@protocol/private` → `errors/private-error-codes.ts`), `scripts/build/rewrite-aliases.mjs` target, `scripts/desktop/{package,finalize-package,verify-runtime}.mjs` and `scripts/extension/package-companion.mjs` (`dist/packages/protocol/src/local-limits.js` → `dist/packages/protocol/src/local/local-limits.js`), `AGENTS.md` line "Shared wire vocabulary belongs in `packages/protocol/src/values/`" → "belongs in the owning domain's `*values.ts` under `packages/protocol/src/<domain>/`".

**Interfaces:**
- Consumes: aliases from Task 3 (nothing outside the package imports a protocol file path anymore).
- Produces: unchanged public export set of `@protocol`.

- [ ] **Step 1: Pin the public API (test first)**

Create `tests/protocol-public-api.test.ts`: `expect(Object.keys(await import('@protocol')).sort()).toMatchSnapshot()`. Run once to write the snapshot; commit nothing.

- [ ] **Step 2: Move files with `git mv` per the table, then fix internal relative imports**

Run: `node node_modules/typescript/bin/tsc --noEmit` until clean; use the compiler errors as the to-do list.

- [ ] **Step 3: Verify the API did not change**

Run: `node node_modules/vitest/vitest.mjs run tests/protocol-public-api.test.ts tests/domain-values.test.ts tests/domain-value-lint.test.ts tests/build-aliases.test.ts`
Expected: PASS, snapshot unchanged.

- [ ] **Step 4: Checkpoint** — `npm run validate` exits 0.

---

### Task 5: Restructure crowded backend directories and add the structure gate

**Files:**
- Create: `scripts/check-source-structure.mjs`; Test: `tests/source-structure.test.ts`
- Modify: `package.json` (`lint:structure:source` script; prepend it to `build`)
- Move (`git mv`, contents unchanged except relative imports):

| Directory | New layout |
|---|---|
| `apps/daemon/src/codex` (19) | root: `manager.ts`, `launcher.ts`, `events.ts`, `errors.ts`; `rpc/`: `rpc-client.ts`, `transport.ts`; `desktop/`: `desktop-client.ts`, `desktop-ipc.ts`, `desktop-state.ts`, `desktop-user-input.ts`; `binding/`: `binding.ts`, `approvals.ts`, `user-inputs.ts`, `file-changes.ts`, `subagents.ts`; `history/`: `current-step.ts`, `tool-item-type.ts`, `history-times.ts`, `model-reader.ts`; existing `launch/`, `lifecycle/` |
| `apps/daemon/src/profiles/runtime` (16) | root: `service.ts`, `types.ts`; `execution/`: `execution-{mutations,ownership,recovery,schema,values}.ts`, `wait-for-inactive.ts`; `router/`: `request-router.ts`, `request-router-helpers.ts`, `relay.ts`; `native/`: `native.ts`, `close-proofs.ts`, `close-proof-values.ts`, `enrollment-adapter.ts`, `cli.ts` |
| `apps/daemon/src/attachments` (12) | root: `service.ts`, `types.ts`, `errors.ts`, `limits.ts`; `relay/`: `relay-mirror.ts`, `local-backend.ts`, `io.ts`; `content/`: `history.ts`, `input.ts`, `image-content.ts`, `native.ts`, `source-current.ts` |
| `apps/daemon/src/code` (11) | root: `pty-session-manager.ts`, `transcript-activity.ts`; `hooks/`: `hook-server.ts`, `install-hooks.ts`, `ipc.ts`; `transcript/`: `transcript-{file,limits,window,reader,pages,title}.ts` |
| `apps/daemon/src/monitor` (10) | root: `monitor.ts`, `store.ts`, `replay.ts`, `history.ts`; `activity/`: `activity-kind.ts`, `current-step.ts`, `tool-kinds.ts`, `subagents.ts`; `local/`: `local-command.ts`, `local-history.ts` |
| `apps/daemon/src/domain` (8) | `codex/`: `codex.ts`, `codex-desktop.ts`; rest stays |
| `apps/daemon/src/continuity/context` (8) | `storage/`: `storage.ts`, `attachments.ts`; rest stays |
| `apps/daemon/src/cli` (8) | `personal/`: `personal.ts`, `personal-bot.ts`, `personal-runtime.ts`, `personal-tunnel.ts`; rest stays |
| `apps/daemon/src/sessions` (7) | `launch/`: `launch-context.ts`, `launcher.ts`, `restore-launch.ts`; rest stays |
| `packages/transport/src` (7) | `continuity/`: `continuity-client.ts`, `continuity-client-scope.ts`, `continuity-client-validation.ts`, `continuity-client.types.ts` |
| `apps/server/src/continuity/services` (7) | `seed/`: `seed-intent.ts`, `seed-proof.ts` |
| `apps/desktop/src/main` (7) | `ipc/`: `ipc.ts`, `ipc.types.ts` |

**Interfaces:**
- Produces: `checkSourceStructure(root: string): string[]` (issues) exported from `scripts/check-source-structure.mjs`; CLI prints `Source structure clean` on success, exits 1 with one issue per line otherwise. Roots: `apps/daemon/src`, `apps/server/src`, `apps/desktop/src`, `apps/chrome-extension/src`, `packages/protocol/src`, `packages/transport/src`. Rule: a directory has at most 6 files matching `\.(ts|mjs)$`, excluding `index.ts` and `*.d.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/source-structure.test.ts
it('flags a directory with 7 source files', () => { /* mkdtemp, write a.ts…g.ts */ expect(checkSourceStructure(root)).toEqual([expect.stringContaining('more than 6 files')]); });
it('ignores index.ts and .d.ts', () => { /* 6 files + index.ts + x.d.ts */ expect(checkSourceStructure(root)).toEqual([]); });
it('passes on the repository', () => { expect(checkSourceStructure(process.cwd())).toEqual([]); });
```

- [ ] **Step 2: Run** — first two fail (module missing); third fails listing the 12 directories above.

- [ ] **Step 3: Implement the script; run** — first two pass, third still lists the 12 directories.

- [ ] **Step 4: Apply the moves per the table, one directory at a time; after each run `node node_modules/typescript/bin/tsc --noEmit`** — exit 0 before moving to the next directory.

- [ ] **Step 5: Run** `node node_modules/vitest/vitest.mjs run tests/source-structure.test.ts` — PASS (3 tests). Add `"lint:structure:source": "node scripts/check-source-structure.mjs"` and prepend `npm run lint:structure:source &&` to `build`.

- [ ] **Step 6: Checkpoint** — `npm run validate && npm run package:desktop` exit 0; `codegraph sync .`.

---

### Task 6: HTTP status vocabulary and code-derived `Fault` status

**Files:**
- Modify: `packages/protocol/src/connection/http.ts` (add `HttpStatus`)
- Create: `apps/server/src/http/fault.ts` (move `Fault` out of `auth/security.ts`), `apps/server/src/http/fault-status.ts`
- Modify: `apps/server/src/auth/security.ts` (re-export removed; callers import from `../http/fault.js`), all 188 `new Fault(...)` sites in `apps/server/src`
- Modify: `apps/daemon/eslint.config.mjs` (`no-restricted-syntax`)
- Test: `tests/fault-status.test.ts`, `tests/domain-value-lint.test.ts`

**Interfaces:**
- Produces: `HttpStatus = { Ok: 200, NoContent: 204, BadRequest: 400, Unauthorized: 401, Forbidden: 403, NotFound: 404, MethodNotAllowed: 405, RequestTimeout: 408, Conflict: 409, Gone: 410, PayloadTooLarge: 413, TooManyRequests: 429, InternalServerError: 500, ServiceUnavailable: 503 } as const` and `type HttpStatus`, exported from `@protocol`.
- Produces: `type FaultCode = ErrorCode | ServerErrorCode | AttachmentFaultCode | ContinuityError`; `faultStatus(code: FaultCode): HttpStatus`; `class Fault extends Error { constructor(readonly code: FaultCode, readonly status: HttpStatus = faultStatus(code)) }`.

The table (`fault-status.ts`, `satisfies Partial<Record<FaultCode, HttpStatus>>`, unlisted codes → `HttpStatus.BadRequest`, which is today's default). Values reproduce every pair measured in the baseline:

| Status | Codes |
|---|---|
| `Unauthorized` | `UNAUTHORIZED` |
| `Forbidden` | `ACCESS_DENIED` |
| `NotFound` | `NOT_FOUND`, `ContinuityError.NotFound` |
| `RequestTimeout` | `AttachmentFaultCode.UploadTimeout` |
| `Conflict` | `CAPABILITY_UNAVAILABLE`, `COMMAND_ID_REUSED`, `DEVICE_OFFLINE`, `DEVICE_QUOTA`, `INVALID_DEVICE`, `INVALID_FRAME`, `LOCAL_REVISION_CONFLICT`, `PAIRING_UNAVAILABLE`, `PERMISSION_EXPIRED`, `PROFILE_NOT_READY`, `REQUEST_FAILED`, `SESSION_NOT_IDLE`, `STALE_EPOCH`, `STALE_SESSION`, `USER_INPUT_EXPIRED`, `AttachmentFaultCode.{IdReused,Mismatch}`, every `ContinuityError` member except `NotFound` |
| `Gone` | `AttachmentFaultCode.Expired` |
| `PayloadTooLarge` | `AttachmentFaultCode.{TooLarge,Quota}` |
| `TooManyRequests` | `RATE_LIMITED`, `QUEUE_FULL`, `AttachmentFaultCode.UploadBusy` |
| `ServiceUnavailable` | `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `ATTACHMENT_UNAVAILABLE`, `HISTORY_RELOAD_FAILED`, `AttachmentFaultCode.RebuildRequired` |

Two deliberate decisions: `INVALID_FRAME`/`INVALID_DEVICE` map to `Conflict`; their 4 default-400 sites (`relay.ts:1052,1225,1302,1365`) sit in WebSocket handlers that send only `code`, so no client observes the change. `ContinuityError.InvalidPhase` maps to `Conflict`; its one 400 site (`continuity/services/transitions.ts:246`, invalid failure phase argument) passes the explicit override `HttpStatus.BadRequest`. Dynamic forwarding sites (`new Fault(reply.code, 409)`, `new Fault(frame.error, 503)`, `new Fault(code, 409)`) pass `HttpStatus.Conflict` / `HttpStatus.ServiceUnavailable` explicitly.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/fault-status.test.ts
it.each([
  [ErrorCode.UNAUTHORIZED, 401], [ErrorCode.NOT_FOUND, 404], [ErrorCode.PROFILE_NOT_READY, 409],
  [ErrorCode.RATE_LIMITED, 429], [ErrorCode.INTERNAL_ERROR, 503], [ErrorCode.INVALID_REQUEST, 400],
  [AttachmentFaultCode.Expired, 410], [AttachmentFaultCode.TooLarge, 413], [AttachmentFaultCode.UploadTimeout, 408],
  [ContinuityError.NotFound, 404], [ContinuityError.VersionConflict, 409], [ErrorCode.INVALID_CURSOR, 400],
])('%s → %i', (code, status) => expect(new Fault(code).status).toBe(status));
it('keeps an explicit override', () => expect(new Fault(ContinuityError.InvalidPhase, HttpStatus.BadRequest).status).toBe(400));
```
Add lint cases to `tests/domain-value-lint.test.ts`: `new Fault(ErrorCode.NOT_FOUND, 404)`, `res.status(404)`, `response.status === 410`, `new Response(null, { status: 405 })` each report `no-restricted-syntax`; the `HttpStatus.*` forms report nothing.

- [ ] **Step 2: Run** — FAIL (module `apps/server/src/http/fault.ts` missing; lint cases unreported).

- [ ] **Step 3: Implement `HttpStatus`, `fault.ts`, `fault-status.ts`**

- [ ] **Step 4: Rewrite call sites**

Run once (not committed): `perl -0pi -e 's/new Fault\(\s*((?:ErrorCode|ContinuityError|AttachmentFaultCode|ServerErrorCode)\.\w+),\s*\d{3},?\s*\)/new Fault($1)/g' $(git ls-files 'apps/server/src/**/*.ts')`. Then fix the remaining ones by hand (dynamic codes, the conditional attachment parser error at `attachments/routes.ts` → `new Fault(tooLarge ? AttachmentFaultCode.TooLarge : AttachmentFaultCode.Invalid)`, `res.status(available ? 204 : 404)` → `HttpStatus.NoContent : HttpStatus.NotFound`). Replace literal `'UNAUTHORIZED'`/`'STALE_EPOCH'` comparisons in `relay.ts` with `ErrorCode.*`, and `route('get', …)` with `HttpMethod.Get`.

- [ ] **Step 5: Add the lint rule to `nodeSourceConfig`**

`'no-restricted-syntax': ['error', ...]` with selectors (message: "Use HttpStatus / derive from the error code."):
- `NewExpression[callee.name='Fault'] > Literal.arguments`
- `CallExpression[callee.property.name='status'] > Literal`
- `BinaryExpression[operator=/^[!=]==$/]:has(MemberExpression[property.name=/^(status|statusCode|error_code)$/]) > Literal[raw=/^[1-5]\\d\\d$/]`
- `Property[key.name='status'] > Literal[raw=/^[1-5]\\d\\d$/]`

- [ ] **Step 6: Run** `node node_modules/vitest/vitest.mjs run tests/fault-status.test.ts tests/domain-value-lint.test.ts` and `npm run lint:source` — PASS / exit 0. Then the HTTP suites: `node node_modules/vitest/vitest.mjs run tests/server.test.ts tests/attachment-http.test.ts tests/preferences-http.test.ts tests/conversation-ownership.test.ts tests/continuity-command-claims.test.ts` — PASS.

- [ ] **Step 7: Checkpoint** — `npm run validate` exits 0.

---

### Task 7: Remaining numeric statuses and WebSocket close codes

**Files:**
- Modify: `packages/protocol/src/connection/values.ts` (add `SocketCloseCode`, `SocketCloseReason`)
- Modify: `apps/server/src/relay.ts` (8 `.close(4xxx, '…')` sites), `apps/daemon/src/relay-client.ts` (`code === 4003`), `apps/mini-app/src/shared/api/transport.ts` (`code === 4001`)
- Modify: `apps/mini-app/src/shared/api/request-error.ts` (`statusCodes` keyed by `HttpStatus`), `apps/mini-app/src/shared/api/commands.ts:94,110`, `apps/mini-app/src/shared/api/attachments.ts:78`, `apps/mini-app/.storybook/fixtures/attachment/access.ts:19`, `apps/chrome-extension/src/client/pending-requests.ts:4`, `apps/desktop/src/main/protocol.ts:43,49,55`, `apps/daemon/src/attachments/service.ts:593`, `apps/server/src/notifications/delivery.ts:121,138`
- Delete: `ProfileApiStatus` in `apps/daemon/src/profiles/api/values.ts` (use `HttpStatus`)
- Modify: `apps/mini-app/eslint.config.mjs` (same `no-restricted-syntax` selectors as Task 6)

**Interfaces:**
- Produces: `SocketCloseCode = { Offline: 4000, Unauthorized: 4001, Replaced: 4002, Revoked: 4003 } as const`; `SocketCloseReason = { Offline: 'OFFLINE', Unauthorized: 'UNAUTHORIZED', AuthTimeout: 'AUTH_TIMEOUT', TokenExpired: 'TOKEN_EXPIRED', Replaced: 'REPLACED', Revoked: 'REVOKED' } as const`; both exported from `@protocol`.

- [ ] **Step 1: Failing lint test** — in `tests/domain-value-lint.test.ts`, `socket.close(4001, 'UNAUTHORIZED')` and `event.code === 4003` report `no-restricted-syntax`. Add selectors `CallExpression[callee.property.name='close'] > Literal` and `BinaryExpression:has(MemberExpression[property.name='code']) > Literal[raw=/^4\\d{3}$/]`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Add the vocabularies and replace every site listed above.** Range checks (`status >= 400 && status < 500`) use `HttpStatus.BadRequest` and `HttpStatus.InternalServerError` as bounds. Leave `'http_status:404'` in `apps/daemon/src/cli/personal-tunnel.ts` (cloudflared configuration syntax) and add `// ponytail: cloudflared ingress syntax, not an HTTP status we own`.
- [ ] **Step 4: Run** `node node_modules/vitest/vitest.mjs run tests/domain-value-lint.test.ts tests/relay-ws.test.ts` and `npm run lint` — PASS / exit 0.
- [ ] **Step 5: Checkpoint** — `npm run validate` exits 0.

---

### Task 8: Characterize the relay HTTP surface before the Nest migration

**Files:**
- Create: `tests/relay-http-surface.test.ts` (uses `createRelay` with the `TEST_DATABASE_URL` pattern from `tests/helpers/database.ts`)

**Interfaces:**
- Produces: a route table constant in the test, `RELAY_ROUTES: Array<[HttpMethod, string, 'principal' | 'device' | 'public']>`, listing all 31 routes: 22 in `relay.ts` (`GET/PATCH /preferences`, `GET /health`, `POST /auth/telegram|refresh|logout`, `POST /device/pair/start|cancel|status|confirm`, `POST /pair/claim`, `POST /devices/:deviceId/profiles`, `GET /devices`, `DELETE /devices/:id`, `GET /devices/:id/snapshot|connectors|events`, `GET|PUT /sessions/:id/reading-position`, `GET /sessions/:id/events`, `PATCH /sessions/:id`, `POST /commands`, `GET /commands/:id`), 7 in `continuity/routes.ts`, and attachment `POST|HEAD|GET` for both `/sessions/:sessionId/attachments` and `/device/sessions/:sessionId/attachments`.

- [ ] **Step 1: Write the tests against the current Express code**
  - Every `principal` and `device` route without `Authorization` returns `401` with body `{ code: 'UNAUTHORIZED' }`.
  - `GET /health` returns `200` `{ status: 'ok' }` with headers `cache-control: no-store`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff` and no `x-powered-by`.
  - `PATCH /preferences` with body `{` and with a 129 KB JSON body: record the actual status and body observed now, and assert exactly those values (Review Focus 2).
  - An unknown path returns the current 404 response.
  - `POST /commands` with an invalid body and a valid token returns `400` `{ code: 'INVALID_REQUEST' }`.
- [ ] **Step 2: Run** `node node_modules/vitest/vitest.mjs run tests/relay-http-surface.test.ts` — PASS on the current implementation. If a case fails, fix the test's expectation to the observed behavior, not the code.
- [ ] **Step 3: Checkpoint** — `npm run validate` exits 0.

---

### Task 9: Nest application core and simple controllers

**Files:**
- Modify: `tsconfig.json` (`"experimentalDecorators": true`)
- Create: `apps/server/src/app/relay-config.ts` (`RELAY_CONFIG` token, `RelayConfig` moved here), `apps/server/src/app/core.module.ts` (`@Global()`: `RELAY_CONFIG`, `Database`, `MESSAGING`, `Limiter`, `AuthService`, `DeviceService`, `DeviceFence`, `BrowserSessions`), `apps/server/src/app/relay.module.ts`, `apps/server/src/app/create-relay.ts` (facade), `apps/server/src/app/health.controller.ts`
- Create: `apps/server/src/http/bearer.ts` (single `bearer(req)`, replaces copies in `relay.ts:94` and `attachments/routes.ts:17`), `apps/server/src/http/fault.filter.ts`, `apps/server/src/http/principal.guard.ts`, `apps/server/src/http/current-principal.ts`
- Create: `apps/server/src/auth/auth.controller.ts`, `apps/server/src/auth/auth.module.ts`, `apps/server/src/devices/pairing.controller.ts`, `apps/server/src/preferences/preferences.controller.ts`, `apps/server/src/reading-position/reading-position.controller.ts`
- Modify: `apps/server/src/relay.ts` (shrinks; routes above removed), `apps/server/src/main.ts` (import `createRelay` from `./app/create-relay.js`)

**Interfaces:**
- Consumes: `Fault`, `faultStatus`, `HttpStatus` (Task 6).
- Produces:
  - `RELAY_CONFIG: unique symbol`, `MESSAGING: unique symbol` (value `Messaging | undefined`).
  - `FaultFilter implements ExceptionFilter` (`@Catch()` everything): `Fault` → its status; `ZodError` → `400 INVALID_REQUEST`; Nest `HttpException` (body-parser / 404 routing) → reproduce Task 8's recorded responses; anything else → `503 INTERNAL_ERROR`. Response body is exactly `{ code }`. Skip writing when `res.headersSent`.
  - `PrincipalGuard implements CanActivate`: reads `bearer(req)`, calls `AuthService.authenticate`, stores the `Principal` on the request under a module-private `WeakMap<Request, Principal>`; `@CurrentPrincipal()` param decorator reads it.
  - `createRelay(config: RelayConfig): Promise<Relay>` with `Relay` = exactly today's return shape (`db`, `messaging`, `auth`, `devices`, `attachments`, `command`, `dispatchHandoffCreate`, `replay`, `live`, `notify`, `listen(port?, host?)`, `close()`).
- Constraints: `NestFactory.create(RelayModule, { logger: false, bodyParser: false })`; JSON body parser via `MiddlewareConsumer` `express.json`-equivalent from `@nestjs/platform-express` (`app.useBodyParser('json', { limit: '128kb', strict: true })` is global, so instead apply a `JsonBodyMiddleware` through `consumer.apply(...).exclude({ path: 'sessions/:sessionId/attachments', method: RequestMethod.POST }, { path: 'device/sessions/:sessionId/attachments', method: RequestMethod.POST }).forRoutes('*')`). Security headers and `x-powered-by` disable move to a middleware applied to all routes. Static files: `app.useStaticAssets(config.staticDirectory)` after `app.init()` so API routes keep priority.

- [ ] **Step 1: Enable decorators** — set `experimentalDecorators: true`; run `node node_modules/typescript/bin/tsc --noEmit` — exit 0.
- [ ] **Step 2: Write the facade test first** — `tests/relay-facade.test.ts`: `createRelay()` result has exactly the 12 keys listed above (`Object.keys(...).sort()` equals the sorted list); `listen(0)` returns `http://127.0.0.1:<port>`; `close()` resolves and a second `fetch` to the URL rejects. Run — PASS on the old code (it pins behavior).
- [ ] **Step 3: Build core module, filter, guard, facade; move `health`, `auth/*`, `device/pair/*` + `pair/claim`, `preferences`, `reading-position` routes into the controllers.** Rate-limit keys (`'auth:' + req.ip`, `'refresh:'`, `'pair-start:'`, `'pair-ip:'`, `'pair-owner:'`) move unchanged into an `as const` `RateLimitKey` object in `auth/security.ts`. Cookies use `@Res({ passthrough: true })`.
- [ ] **Step 4: Run** `node node_modules/vitest/vitest.mjs run tests/relay-http-surface.test.ts tests/relay-facade.test.ts tests/preferences-http.test.ts tests/server.test.ts tests/integration/service.test.ts` — PASS.
- [ ] **Step 5: Checkpoint** — `npm run validate` exits 0.

---

### Task 10: Injectable WebSocket hub, device/session/command controllers, maintenance jobs

**Files:**
- Create: `apps/server/src/realtime/relay-hub.ts` (`@Injectable() RelayHub`: `live`, `clients`, `sender`, `send`, `fanout`, `closing`), `apps/server/src/realtime/app-socket.ts` (body of `appWss.on('connection')`, `relay.ts:960-1078`), `apps/server/src/realtime/device-socket.ts` (`relay.ts:1079-1391`), `apps/server/src/realtime/upgrade.ts` (`relay.ts:940-959`), `apps/server/src/realtime/maintenance.service.ts` (`relay.ts:1393-1432`, `OnModuleInit` starts, `OnApplicationShutdown` clears), `apps/server/src/realtime/realtime.module.ts`
- Create: `apps/server/src/devices/device-state.ts` (`snapshot`, `replay`, `offline`), `apps/server/src/devices/devices.controller.ts`, `apps/server/src/devices/devices.module.ts`, `apps/server/src/sessions/sessions.controller.ts`, `apps/server/src/sessions/sessions.module.ts`
- Create: `apps/server/src/commands/command-dispatcher.ts` (`command`, `dispatchHandoffCreate`, `executeCommand` from `relay.ts:306-617`), `apps/server/src/commands/commands.controller.ts`, `apps/server/src/commands/commands.module.ts`; move `apps/server/src/continuity/command-claims.ts` → `apps/server/src/commands/command-claims.ts`
- Create: `apps/server/src/notifications/notify.ts` (`notify` from `relay.ts:226-238`)
- Delete: `apps/server/src/relay.ts` when empty

**Interfaces:**
- Consumes: `RelayHub` is the only owner of `live`/`clients`; `SourceHistory`, `ProfileProxy`, `ContinuityProxy`, `ServerProfiles` keep their constructor signatures and receive `hub.live` / `hub.send` through `useFactory`.
- Produces: `RelayHub.attach(server: http.Server): void` called from `RealtimeModule.onApplicationBootstrap()` using `HttpAdapterHost`; `RelayHub.shutdown(): Promise<void>` performing today's `close()` order: set `closing`, close `sourceHistory`/`profileProxy`/`continuityProxy`, terminate all sockets, close both `WebSocketServer`s; `createRelay().close()` then runs `app.close()`, `fence.drain()`, `messaging.close()`, `db.close()`.

- [ ] **Step 1: Add the shutdown test first** — in `tests/relay-facade.test.ts`: open one app socket and one device socket, call `close()`, assert both sockets receive `close` and `vi.getTimerCount()` (with fake timers enabled only around `setInterval` creation) is 0 afterwards (Review Focus 5). Add a logout case if `tests/relay-ws.test.ts` lacks one: after `POST /auth/logout`, the app socket of that token closes with `SocketCloseCode.Unauthorized` (Review Focus 4). Run — PASS on the current code.
- [ ] **Step 2: Move the code per the file list.** Keep function bodies verbatim; change only how dependencies arrive (constructor `@Inject`). Every raw `db.pool.query` moved out of `relay.ts` keeps its SQL text unchanged.
- [ ] **Step 3: Run** `node node_modules/vitest/vitest.mjs run tests/relay-ws.test.ts tests/relay-recovery.test.ts tests/daemon-restart-relay.test.ts tests/history-cache.test.ts tests/messaging-integration.test.ts tests/redis-startup.test.ts tests/personal-permanent-launch.test.ts tests/relay-http-surface.test.ts tests/relay-facade.test.ts` — PASS.
- [ ] **Step 4: Checkpoint** — `npm run validate` exits 0; `npm run test:e2e` exits 0 (real relay + Postgres + browser).

---

### Task 11: Attachments, continuity and profiles as Nest controllers

**Files:**
- Create: `apps/server/src/attachments/http/upload.middleware.ts` (the existing authorize → admission → `raw` parser → error-mapping chain from `attachments/routes.ts:58-190`, as one `NestMiddleware` applied by `consumer.apply(...).forRoutes({ path: '(device/)?sessions/:sessionId/attachments', method: RequestMethod.POST })`), `apps/server/src/attachments/http/attachments.controller.ts` (POST handler that calls `service.store`, plus `HEAD`/`GET :attachmentId`), `apps/server/src/attachments/attachments.module.ts`
- Delete: `apps/server/src/attachments/routes.ts`
- Create: `apps/server/src/continuity/continuity.controller.ts` (from `continuity/routes.ts`), `apps/server/src/continuity/continuity.module.ts`; Delete: `apps/server/src/continuity/routes.ts`
- Move: `apps/server/src/profiles/proxy.ts` → `apps/server/src/profiles/transport/proxy.ts`; Create: `apps/server/src/profiles/profiles.controller.ts`, `apps/server/src/profiles/profiles.module.ts`
- Delete: `apps/server/src/domain/http.ts` `HttpMethod` (routes are decorators now); keep `HealthStatus` (move to `apps/server/src/domain/infrastructure.ts`)

**Interfaces:**
- Consumes: `PrincipalGuard`, `@CurrentPrincipal()`, `FaultFilter` (Task 9); `RelayHub`, `CommandDispatcher.dispatchHandoffCreate` (Task 10).
- Produces: none new; the HTTP surface pinned in Task 8 is unchanged.

- [ ] **Step 1: Failing test for Review Focus 1** — in `tests/attachment-http.test.ts`, upload a 1 KB attachment with `Content-Type: application/json` and body `{"a":1}` + 1 000 spaces; read it back via `GET`; bytes are identical. Run — PASS on the current code (pins behavior).
- [ ] **Step 2: Migrate the three route groups.** The profiles route keeps the `AbortController` cancelled on `res.once('close')` (needs `@Res({ passthrough: true })`). The continuity guard argument `authorize` becomes a call to `AuthService.authenticate(bearer(req))` inside the controller, unchanged in timing.
- [ ] **Step 3: Run** `node node_modules/vitest/vitest.mjs run tests/attachment-http.test.ts tests/attachment-relay-security.test.ts tests/conversation-ownership.test.ts tests/continuity-command-claims.test.ts tests/handoff-seed-proof-ws.test.ts tests/profile-proxy.test.ts tests/profile-relay-cancellation.test.ts tests/relay-http-surface.test.ts` — PASS.
- [ ] **Step 4: Checkpoint** — `npm run validate && npm run test:e2e` exit 0.

---

### Task 12: Remove the direct Express dependency, update docs, final gate

**Files:**
- Modify: `package.json` (remove `"express": "5.3.0"` from `dependencies`), `pnpm-lock.yaml` (via `pnpm install`)
- Modify: every remaining `import express` (only type imports `import type { Request, Response } from 'express'` may remain; runtime parsers come from `@nestjs/platform-express`-provided `express` through `app.getHttpAdapter()` or `useBodyParser`)
- Modify: `README.md` architecture paragraph if it names files that moved; `docs/superpowers/specs/2026-10-16-telegram-cmux-design.md` unchanged
- Modify: `Dockerfile` build stage — it runs `npm run build` (which lints) but never copies `eslint/`, root `eslint.config.mjs`, `tests/extension-e2e` and other lint inputs; found broken before this plan (Task 3). Copy exactly what `build` reads; the runtime stage stays `node_modules` + `dist` + `package.json`.

**Interfaces:** none.

- [ ] **Step 1: Prove no runtime import of `express` remains** — `grep -rnE "^import (express|\{[^}]*\} from 'express')" apps/server/src` returns only `import type` lines.
- [ ] **Step 2: Remove the dependency** — `npm exec --package=pnpm@10.34.7 -- pnpm remove express`; Expected: lockfile updated, `node_modules/express` gone from the root (Nest's copy remains under `.pnpm`).
- [ ] **Step 3: Full gate**

Run, in order: `npm run validate`, `npm run package:desktop`, `npm run test:e2e`, `docker build -t agent-remote-final-check .`, `npm run security:check`, `npm run security:test`, `codegraph sync .`
Expected: every command exits 0.

- [ ] **Step 4: Report** — list per task: files changed, tests added, gate output. Commit only if the user asks.

---

### Task 13: SQL only in repositories (server)

**Files:**
- Create: `apps/server/src/<module>/repository.ts` (or `repositories/`) for `devices`, `attachments`, `commands`, `sessions`, `auth`, `preferences`, `reading-position`, `history` wherever their services or controllers call `db.pool.query`/`tx.query`
- Create: `scripts/check-sql-placement.mjs`; Test: `tests/sql-placement.test.ts`; Modify: `package.json` (`lint:sql`, prepended to `build`)

**Interfaces:**
- Produces: `checkSqlPlacement(root: string): string[]` — reports every `.query(` call on `pool`/`tx`/`client` outside files named `repository.ts`, `repositories/*.ts` or `apps/server/src/db/*`. Repositories are plain classes taking `Database`, registered in their Nest module with `useFactory`.
- SQL text, parameters and transaction boundaries stay byte-identical; only their location changes. Every query that today filters by `owner_id` keeps that filter.

- [ ] Step 1: Write `tests/sql-placement.test.ts` (fixture with a stray `pool.query` is reported; repository file is not; repository root passes). Run: FAIL.
- [ ] Step 2: Implement the script; run: fixture tests pass, repository test lists offenders.
- [ ] Step 3: Move queries module by module; after each, run that module's HTTP/WS tests named in Tasks 9–11.
- [ ] Step 4: Run `node node_modules/vitest/vitest.mjs run tests/sql-placement.test.ts tests/relay-http-surface.test.ts tests/attachment-http.test.ts tests/relay-ws.test.ts tests/conversation-ownership.test.ts` — PASS.
- [ ] Step 5: Checkpoint — commit `refactor(server): keep SQL in repositories`.

---

### Task 14: Cheap socket authentication and queued retention

**Files:**
- Modify: `apps/server/src/realtime/maintenance.service.ts`, `apps/server/src/realtime/relay-hub.ts` (connection record), `apps/server/src/auth/auth-service.ts` (return expiry), `apps/server/src/notifications/queue.ts` or a new `apps/server/src/maintenance/retention-queue.ts`
- Test: `tests/relay-auth-recheck.test.ts`, `tests/retention.test.ts`

**Interfaces:**
- `AuthService.authenticate(token, now?)` returns `Principal & { expiresAt: number }` (add `a.expires_at` to the existing SELECT).
- `AppConnection.expiresAt: number`. The 1 s timer closes sockets whose `expiresAt <= Date.now()` with `SocketCloseCode.Unauthorized` / `SocketCloseReason.TokenExpired` without SQL. A database re-check of every app socket runs every `AUTH_RECHECK_MS = 30_000` (named constant) to catch revocations made on another instance. Same-instance logout keeps its immediate close.
- Retention: when Redis messaging exists, a BullMQ repeatable job (`every: 60_000`, one job id so only one instance runs it) executes retention; without Redis (tests), the in-process interval stays at 60 s. Deletes run in batches of `RETENTION_BATCH = 5_000` rows (`DELETE … WHERE ctid IN (SELECT ctid … LIMIT $n)` looped until 0), using the `events_retention(device_id, occurred_at)` index. Rules stay: events older than 24 h, more than 10 000 per device; `command_audit` ack timeout 15 s and 24 h cleanup.

- [ ] Step 1: Tests first — with fake timers: 100 open app sockets cause 0 `auth_sessions` queries during 29 s and one batch at 30 s (spy on `db.pool.query`); an expired token closes within 1 s with `TOKEN_EXPIRED`; retention removes 12 000 old events in batches and keeps the newest 10 000 per device. Run: FAIL.
- [ ] Step 2: Implement. Step 3: Run the new tests plus `tests/relay-ws.test.ts tests/messaging-integration.test.ts tests/redis-startup.test.ts` — PASS.
- [ ] Step 4: Checkpoint — commit `perf(server): stop per-second auth queries and queue retention`.

---

### Task 15: Logging and honest 500s

**Files:**
- Modify: `apps/server/src/app/create-relay.ts` (Nest logger enabled), `apps/server/src/http/fault.filter.ts`, `apps/server/src/http/fault-status.ts`, background `catch` blocks in `apps/server/src/**`, `apps/daemon/src/**` empty catches
- Create: `apps/daemon/src/diagnostics/log.ts`
- Test: `tests/fault-filter-logging.test.ts`

**Interfaces:**
- Server: `NestFactory.create(..., { logger: new ConsoleLogger({ json: true, logLevels: ['error','warn','log'] }) })` (verify the `json` option exists in 12.1.3 types; if not, plain `ConsoleLogger`). `FaultFilter` logs every non-`Fault`, non-`ZodError` error with `Logger.error(message, stack, 'FaultFilter')` and answers `HttpStatus.InternalServerError` + `{ code: 'INTERNAL_ERROR' }`. `faultStatus(ErrorCode.INTERNAL_ERROR)` becomes `InternalServerError`; explicit unavailability keeps `SERVICE_UNAVAILABLE` → 503. Never log tokens, init data, cookies, prompt or chat content: log `error.name`, `error.message` when it matches `/^[A-Z][A-Z0-9_]*$/`, and the stack.
- Daemon: `logDebug(scope: string, error: unknown): void` writes one JSON line to stderr only when `REMOTE_DEBUG === '1'`. Every `catch {}` / `.catch(() => {})` in `apps/daemon/src` and `apps/server/src` either logs (`logDebug` / `Logger.warn`) or carries `// ignore: <reason>` on the same line.
- Frontend check: confirm `apps/mini-app/src/shared/api/request-error.ts` still maps a 500 with body code `INTERNAL_ERROR` to that code (body code wins over the status fallback).

- [ ] Step 1: Test — a controller error `new Error('boom')` yields 500 `{ code: 'INTERNAL_ERROR' }` and one logger error call whose arguments do not contain the bearer token used in the request. Run: FAIL.
- [ ] Step 2: Implement; update Task 6's status table test (`INTERNAL_ERROR` → 500) and the Task 8 surface test only where it asserted 503 for an internal error.
- [ ] Step 3: Run `tests/fault-filter-logging.test.ts tests/fault-status.test.ts tests/relay-http-surface.test.ts` and the mini-app request-error tests — PASS.
- [ ] Step 4: Checkpoint — commit `feat: structured server logging and 500 for internal errors`.

---

### Task 16: Device protocol version handshake

**Files:**
- Modify: `packages/protocol/src/session/schemas.ts` (device `Auth` frame at today's `schemas.ts:306`, `Authenticated` at `:328`), `packages/protocol/src/local/local-limits.ts` or a new `packages/protocol/src/connection/protocol-version.ts`, `apps/server/src/realtime/device-socket.ts`, `apps/daemon/src/relay-client.ts`, `packages/protocol/src/errors/error-codes.ts`
- Test: `tests/protocol-version-handshake.test.ts`

**Interfaces:**
- `RELAY_PROTOCOL = { Current: 2, MinimumSupported: 1 } as const`.
- Device `Auth` frame gains `protocolVersion: z.number().int().positive().optional()`; absent means 1.
- Relay: version below `MinimumSupported` or above `Current` → send `{ type: FrameType.Error, code: ErrorCode.PROTOCOL_UNSUPPORTED }` and close with `SocketCloseCode.ProtocolUnsupported = 4004`, reason `SocketCloseReason.ProtocolUnsupported = 'PROTOCOL_UNSUPPORTED'`. The `Authenticated` reply includes `protocolVersion` **only when the device sent one** (an old daemon parses `Authenticated` strictly and would reject the extra field).
- Daemon sends `protocolVersion: RELAY_PROTOCOL.Current`; on `PROTOCOL_UNSUPPORTED` it stops reconnecting and surfaces the code.
- Rule documented in `packages/protocol/src/connection/protocol-version.ts` header comment: adding or changing a field in any frame crossing daemon↔relay requires bumping `Current`.

- [ ] Step 1: Tests — old daemon (no version) still authenticates and receives `Authenticated` without `protocolVersion`; new daemon receives `protocolVersion: 2`; version 99 receives `PROTOCOL_UNSUPPORTED` and close 4004. Run: FAIL.
- [ ] Step 2: Implement. Step 3: Run the new test plus `tests/relay-ws.test.ts tests/daemon.test.ts tests/daemon-restart-relay.test.ts tests/protocol.test.ts` — PASS.
- [ ] Step 4: Checkpoint — commit `feat(protocol): version handshake between daemon and relay`.

---

### Task 17: Typed errors in the daemon

**Files:**
- Create: `packages/protocol/src/errors/coded-error.ts` (exported from `@protocol`)
- Modify: every `throw new Error(<code>)` in `apps/daemon/src` (566 sites), every `error.message ===`/`!==` comparison, `apps/server/src/http/fault.ts` (`Fault extends CodedError`)
- Modify: `apps/daemon/eslint.config.mjs` (rules), `eslint/domain-values.mjs` (`no-inline-error-codes` also checks `BinaryExpression`, `ConditionalExpression` inside `throw`, and `Property` values that look like error codes)
- Test: `tests/coded-error.test.ts`, `tests/domain-value-lint.test.ts`

**Interfaces:**
- `class CodedError<C extends string = string> extends Error { readonly code: C; constructor(code: C, options?: ErrorOptions) }` — `message === code`, `name === 'CodedError'`, so every consumer that forwards `error.message` (including `apps/daemon/bin/remote.mjs`'s `/^[A-Z_0-9]+$/` check) keeps working.
- `errorCode(error: unknown): string | undefined` (reads `.code` of `CodedError`, else `undefined`); `hasErrorCode(error: unknown, code: string): boolean`.
- Lint in `apps/daemon/src`: `ThrowStatement > NewExpression[callee.name='Error']` is an error ("throw CodedError"); `BinaryExpression[left.property.name='message']` comparisons are an error ("compare errorCode(error)").

- [ ] Step 1: Tests — `new CodedError('X').message === 'X'`; `hasErrorCode`; lint cases for `throw new Error(ErrorCode.X)`, `error.message === ErrorCode.X`, `code === 'STALE_EPOCH'`, `{ error: 'HISTORY_RELOAD_FAILED' }`, `throw new Error(cond ? 'A_B' : 'C_D')` all reported. Run: FAIL.
- [ ] Step 2: Implement the class and rules; codemod `throw new Error(` → `throw new CodedError(` where the argument is a code expression; fix the rest by hand; replace message comparisons with `hasErrorCode`.
- [ ] Step 3: Run `npm run lint:source`, `node node_modules/typescript/bin/tsc --noEmit`, full `npm test -- --maxWorkers=4` — exit 0.
- [ ] Step 4: Checkpoint — commit `refactor(daemon): typed coded errors`.

---

### Task 18: Split `apps/daemon/src/main.ts`; reason codes instead of UI text

**Files:**
- Create: `apps/daemon/src/runtime/relay-frame-router.ts` (frame routing, today `main.ts:343-405`), `apps/daemon/src/runtime/source-poller.ts` (desktop + transcript polling, `main.ts:411-~540`), `apps/daemon/src/runtime/native-restart-poller.ts` (`main.ts:~540-589`)
- Modify: `apps/daemon/src/main.ts` (wiring only; target ≤200 lines), the direct session mutation at `main.ts:456-459` goes through a `Monitor` method
- Modify: `apps/daemon/src/main.ts:82` (`reason: 'Для отправки промптов запусти remote claude'`) → `reason: IntegrationReason.CliWrapperRequired`; add `IntegrationReason` to the protocol session/connection values; mini-app renders RU and EN copy for it where it renders `reason` today (follow `apps/mini-app/AGENTS.md`)
- Test: existing daemon suites; new `tests/daemon-relay-frame-router.test.ts` for routing of each frame type

**Interfaces:**
- `class RelayFrameRouter { constructor(deps); route(frame: ServerFrame): Promise<void> }`, `class SourcePoller { start(): void; stop(): void }`, `class NativeRestartPoller { start(): void; stop(): void }`; constructor dependencies are the exact objects `main.ts` passes today.
- `IntegrationReason = { CliWrapperRequired: 'CLI_WRAPPER_REQUIRED' } as const`; the field type of `reason` becomes `IntegrationReason` where the schema allows; if the wire schema is a free string, keep the string type and send the code.

- [ ] Step 1: Router test for every frame type `main.ts` handles today (calls the same collaborator). Run: FAIL.
- [ ] Step 2: Extract classes verbatim; replace the Russian string; add mini-app copy.
- [ ] Step 3: Run `tests/daemon*.test.ts tests/native-restart-handoff.test.ts` + `npm run check:frontend` — exit 0. `grep -rnP '[А-Яа-яЁё]' apps/daemon/src apps/server/src` returns nothing outside comments.
- [ ] Step 4: Checkpoint — commit `refactor(daemon): split main wiring; reason codes`.

---

### Task 19: No import cycles in the daemon

**Files:**
- Create: `scripts/check-cycles.mjs`; Test: `tests/import-cycles.test.ts`; Modify: `package.json` (`lint:cycles`, prepended to `build`)
- Modify: daemon modules to break cycles (known: file cycle `codex/binding/approvals → user-inputs → binding`; module pairs `browser↔local`, `codex↔monitor`, `codex↔profiles`, `codex↔sessions`, `sessions↔profiles`, `code↔monitor`, `commands↔monitor`). Shared contracts move to `apps/daemon/src/domain/` (types and `as const` values only, no behavior).

**Interfaces:**
- `findCycles(root: string, level: 'file' | 'module'): string[][]` — parses relative `import`/`export … from` specifiers of `.ts` files (type-only imports included), resolves `.js`→`.ts`, runs Tarjan SCC. `module` level collapses files to the first directory under `apps/daemon/src`. Both levels must return `[]` for `apps/daemon/src`, `apps/server/src`, `packages/*/src`.

- [ ] Step 1: Tests — fixture `a→b→a` reported at file level; fixture `x/1→y/1`, `y/2→x/2` reported at module level; repository returns `[]` at both levels. Run: first two FAIL (missing module), third lists today's cycles.
- [ ] Step 2: Implement the script. Step 3: Break cycles one pair at a time, `tsc --noEmit` after each.
- [ ] Step 4: Run `tests/import-cycles.test.ts` and the daemon suites — PASS.
- [ ] Step 5: Checkpoint — commit `refactor(daemon): remove import cycles and gate them`.

---

### Task 20: Mini-app `shared/api` into entities

**Files:**
- Move domain APIs from `apps/mini-app/src/shared/api/` (16 files) to `apps/mini-app/src/entities/<entity>/api/` (commands, execution profiles, reading position, preferences, and the rest that name a domain); `shared/api` keeps only transport-level code (`transport.ts`, `request-error.ts`, generic client)
- Modify: `scripts/check-frontend-structure.mjs` (the ≤6 files rule also covers `shared/**`); `tests/frontend-structure-path.test.ts` if needed
- Follow `apps/mini-app/AGENTS.md`; pass `npm run check:frontend`

**Interfaces:** public entity APIs exported through each entity's `index.ts` (FSD public API); Steiger (`npm run lint:fsd`) stays clean.

- [ ] Step 1: Extend the structure check first; run `npm run lint:structure` — FAIL listing `shared/api`.
- [ ] Step 2: Move files; fix imports via each entity's public `index.ts`.
- [ ] Step 3: `npm run check:frontend` — exit 0.
- [ ] Step 4: Checkpoint — commit `refactor(mini-app): domain APIs live in entities`.

---

### Task 21: Toolchain consistency

**Files:**
- Modify: root `package.json` devDependencies (add `eslint`, `@eslint/js`, `typescript-eslint`, `globals` at the exact versions in `apps/mini-app/package.json`), `apps/daemon/eslint.config.mjs` (import them normally, drop `createRequire` from the mini-app), every root script that calls `node apps/mini-app/node_modules/eslint/bin/eslint.js` (call `eslint`), `pnpm-workspace.yaml` (drop `packages/*`: they are alias-only source packages without manifests), `pnpm-lock.yaml`
- Keep root scripts runnable with `npm run …` (the user's entry point); inside scripts replace `npm --prefix apps/mini-app run X` with `pnpm --dir apps/mini-app run X` only if `pnpm` resolves without a network download (`pnpm -v` prints `10.34.7` offline); otherwise keep `npm --prefix` and record the ruling.

- [ ] Step 1: `pnpm install` after manifest edits; Expected: lockfile changes only in the root importer.
- [ ] Step 2: Run `npm run lint`, `npm run validate` — exit 0.
- [ ] Step 3: Checkpoint — commit `chore: root-owned lint toolchain`.

---

### Task 22: Tests mirror the source tree

**Files:**
- Move: `tests/*.test.ts` (272 files) into `tests/<area>/<module>/` where `<area>` ∈ `server`, `daemon`, `protocol`, `transport`, `mini-app`, `extension`, `desktop`, `build`, `security`; keep `tests/e2e`, `tests/extension-e2e`, `tests/desktop-e2e`, `tests/integration`, `tests/helpers` as they are
- Modify: `vitest.config.ts` include globs, `package.json` scripts that list test paths (`test:desktop`, `test:extension`), every moved test's relative `import`/`new URL('../…', import.meta.url)` paths, `scripts/check-source-structure.mjs` (add root `tests/` with cap **12** files per directory)

- [ ] Step 1: Record `vitest list` count before (expected 1190 tests incl. skipped).
- [ ] Step 2: Move with `git mv`; fix paths until `node node_modules/typescript/bin/tsc --noEmit` is clean.
- [ ] Step 3: `vitest list` count equals Step 1; full `npm test -- --maxWorkers=4` — exit 0; `npm run test:desktop`, `npm run test:extension` — exit 0.
- [ ] Step 4: Checkpoint — commit `test: mirror source tree`. Then run the Task 12 final gate again.

---

### Task 25: Desktop Accounts page works on first load (user bug 2026-10-19)

Diagnosed (scratch repro): `DesktopApplicationClient.profiles()` allows a profile request only when `selectedDevice === deviceId`; `selectedDevice` is set only by `selectTarget()`, which `use-application.ts` calls only when `firstDevice !== state.deviceId`. The companion's initial Snapshot (replayed by main when the lease opens) sets `state.deviceId` first, so `selectTarget` never runs and every profile request throws `STALE_EPOCH` → the Accounts form stays disabled (`accounts-page.tsx` disables on `!data`) and shows "This session has changed…". Side race: `desktop-connection.ts` drops events that arrive before the lease is set, so the initial snapshot can also be lost.
- [ ] Test first in `tests/desktop-client-contract.test.ts`: `profiles(deviceId).request({ kind: List })` succeeds with no prior `selectTarget`; update the existing reselect assertion only if the new guard makes it obsolete, keeping device scoping (per-record `deviceId` check in `packages/transport/src/profile-client.ts` and daemon controller) covered by a test that a foreign device id is rejected.
- [ ] Fix: profile guard = connection not stopped (as the web transport does); device scope stays enforced by record checks.
- [ ] Test + fix: events that arrive before the lease are buffered and delivered once the lease is set (no lost initial snapshot).
- [ ] `npm run check:frontend`, `npm run test:desktop`; commit `fix(desktop): profile requests without prior target selection`.

### Task 26: One huge Codex thread must not break every session (user bug 2026-10-19)

Diagnosed (live companion + scratch repro): `DesktopIpcClient.receive` (`apps/daemon/src/codex/desktop/desktop-ipc.ts`) disconnects the whole shared Codex IPC socket on any frame > 32 MiB. A 43 MB thread snapshot does that every ~12 s, the disconnect invalidates all bindings, so the only other visible thread flips to "Session unavailable"; 26 `binding_lost` events and 594 replayed message rows were observed. Separately, leaked test companions (`/private/tmp/desktop-runtime-*`, started by desktop tests with the real `HOME`) kept polling the user's real `~/.codex/ipc/ipc.sock`.
- [ ] Test first in `tests/codex-desktop-ipc.test.ts`: a frame header > 32 MiB followed by a valid frame → client stays connected, oversize bytes are drained without buffering them, the second frame is delivered, and only the request/thread that produced the oversize frame fails with a named code (add `CODEX_FRAME_TOO_LARGE` to `DaemonErrorCode` or reuse an existing equivalent) surfaced on that session as a distinct availability reason.
- [ ] Fix `desktop-ipc.ts` accordingly; cap value unchanged (named constant).
- [ ] Test isolation: every test that launches a companion/desktop runtime sets `HOME` (and `CODEX_HOME` if read) to its temp directory and terminates the child in `afterEach`/`afterAll`; add a check that no `runtime/node` child survives the test file.
- [ ] Commit `fix(daemon): oversize Codex frame fails one thread, not the socket`.

### Task 27: Desktop companion also receives Claude hooks on the legacy socket (user decision 2026-10-19)

Diagnosed: `~/.claude/settings.json` hooks run `remote.mjs hook` without `CLAUDE_REMOTE_HOME`, so they post to `~/.claude-remote/hooks.sock` (`apps/daemon/src/config.ts`, `setup-cli.ts`); the desktop companion listens only at `…/agent-remote-desktop/desktop-companion/hooks.sock`, so Claude Code sessions never reach the desktop app. User decision: the companion ALSO listens on the legacy path; `~/.claude/settings.json` is not modified.
- The legacy listener uses the same hook server, auth and validation as the companion's own socket (no second code path). Socket file mode 0600, parent directory owned by the current user and not group/other-writable (reuse the existing socket-safety helpers); refuse symlinks.
- Never steal a live socket: if `~/.claude-remote/hooks.sock` is accepted by a running CLI daemon (connect succeeds), the companion does not bind it and logs/reports a named state; a stale socket file (connect refused, owned by the user) is replaced. On companion shutdown only a socket the companion created is removed.
- [ ] Tests first (temp HOME): companion binds the legacy path when free; a hook posted there produces the same session as one posted to the companion socket; a live foreign listener is left untouched; a stale socket is replaced; a symlink or wrong-mode parent is refused; shutdown removes only the companion's own socket.
- [ ] Implement in the daemon lane (after Task 26); commit `feat(daemon): desktop companion accepts legacy Claude hook socket`.

### Tasks 32–35: Desktop sidebar, settings menu, subagent view (spec: docs/superpowers/specs/2026-10-19-desktop-sidebar-subagents-design.md, user-approved 2026-10-19)

Read the spec including "Controller calls after the builder check" before any of these. The Storybook spike lives uncommitted in worktree `/Users/vladimir/Desktop/agents-remote-lanes/sidebar` (widgets/session-sidebar, widgets/desktop-header, .storybook/components/desktop, .storybook/fixtures/sidebar-sessions.ts) — port from it, do not merge that branch.

**Task 32 — Settings menu (all hosts).** Header gets a Lucide `Settings` icon button (top right) opening the shared dropdown with "Accounts & keys" (`accountsTitle`); remove the "Accounts & keys" button under the session list (app/home-view.tsx). Static test IDs, RU+EN, story `SettingsMenuOpen` (interaction only). Tests: menu item navigates to accounts; button absent under the list. Commit `feat(mini-app): settings menu with accounts & keys`.

**Task 33 — Desktop sidebar.** Port widgets/session-sidebar and widgets/desktop-header from the spike into the real desktop shell (desktop host only, ≥ 960 px; `/` = placeholder pane; selected session in the right pane via the existing session page; route-driven selection). Status colors unified: one `as const` status→style map in entities/session used by both the sidebar row badge and the existing session card (running blue pulse, waiting amber, idle grey, unavailable hollow ring). Search/⌘K/↑↓/Enter/collapse as in the spec; collapse state in localStorage with try/catch. Mini App unchanged. Stories from the spike (no assertions); e2e: desktop viewport shows sidebar, selecting a row opens the session, search filters, Esc clears. Commit `feat(desktop): session sidebar`.

**Task 34 — Subagent backfill + history API (daemon, protocol, relay).** Optional subagent fields (`type`, `description`, `transcriptAvailable`) with tolerant read parsing; daemon backfill from `subagents/*.meta.json` per the spec (on observe/restore and on list/view open, cap 50 by mtime, `finished` → Completed); history request gains optional `agentId` on both transports; daemon reads only `subagents/agent-<agentId>.jsonl` inside that session's directory and only for ids in that session's list (path built from validated id, realpath must stay inside the dir, no symlinks); relay forwards with the same owner/device/session checks as session history; transcript reader surfaces tool-use/tool-result entries as existing tool activity items behind a flag. Tests: traversal ids (`../x`, absolute, symlinked file) rejected; foreign session's agent rejected; owner mismatch rejected on relay; backfill lists finished/unfinished agents; old-client tolerance (unknown subagent fields stripped). Commit `feat: subagent history and backfill`.

**Task 35 — Subagent view UI (desktop + Mini App).** Clickable subagent rows → route `…/sessions/:sessionId/agents/:agentId`; read-only feed using the existing message renderer with tool activity enabled; per-view history window (session + agentId + generation); live updates only while open; Telegram BackButton wired like the session page; sidebar keeps the parent row selected; states: loading, "Transcript unavailable", offline/observe-only banners. Stories (no assertions) + e2e: open a running subagent, see tool activity, back returns to parent. Commit `feat(mini-app): subagent view`.

Order: 32 and 33 (frontend worktree) in parallel with 34 (daemon/server worktree); 35 after 34 merges.

---

### Task 24: Semgrep SecObserve gate next to Gitleaks

User request 2026-10-19: the same checks as the team's other repositories — Semgrep with `.semgrep/secobserve-high.yml` blocking only NEW High/Critical findings, `# nosemgrep` ignored; Gitleaks on the staged diff. Measured: Gitleaks already runs (`scripts/security/check.mjs`: staged snapshot in pre-commit with `--ignore-gitleaks-allow`, worktree + history in pre-push, CI `repository-safety.yml`). Semgrep is absent. The rules file is identical (sha256 prefix `27f7e7d06277`) in report-service, fabric-cicd and two other repos (generated by `ai-automation/scripts/secobserve_rules.py`; 72 rules, JavaScript/TypeScript included). A full scan of this repo today: 3 findings, all `rules_lgpl_javascript_ssrf_rule-node-ssrf` — `apps/daemon/src/cli/pairing/connect.ts:63`, `apps/mini-app/src/shared/api/request-error.ts:14`, `scripts/smoke-image.ts:79` — plus 1 Semgrep parse error.

**Files:**
- Create: `.semgrep/secobserve-high.yml` — NOT a blind copy (user ruling 2026-10-19). The repository contains only TypeScript/JavaScript (+ Swift, SQL, shell); no Python or C#. From the source file keep only the 44 rules whose `languages` are JavaScript/TypeScript (38 `javascript`, 6 `javascript`+`typescript`); drop the 25 Python and 3 C# rules. Review each kept rule for applicability (Node server, Electron/desktop, browser Mini App) and drop rules for frameworks this repo does not use, listing every dropped rule id with a one-line reason in the task report. Header comment: source path, source sha256, generator (`ai-automation/scripts/secobserve_rules.py`), date, and the filter applied. A test asserts every rule's `languages` ⊆ {javascript, typescript}.
- Runtime: the project has no Python toolchain. Run Semgrep from the official `semgrep/semgrep` Docker image pinned by digest (Docker is already required for the test databases), in both the hook and CI; do not add Python or pip steps. If Docker is unavailable, the hook fails with "Semgrep requires Docker. Scan did not run."
- Modify: `scripts/security/check.mjs` (new `semgrep` step for `staged` mode), `.githooks/pre-commit` (unchanged entry point if check.mjs runs it), `scripts/security/check.test.mjs`, `.github/workflows/repository-safety.yml` (pinned Semgrep install, same flags), `SECURITY.md`, `AGENTS.md` security line
- Modify, if the assessment says so: the three flagged files

**Interfaces / exact behavior:**
- Semgrep flags (match the team's pre-commit config): `--config .semgrep/secobserve-high.yml --disable-nosem --error --baseline-commit HEAD --metrics=off --disable-version-check --quiet --skip-unknown-extensions`, excluding `.semgrep/`.
- It must scan the STAGED snapshot (like the Gitleaks step), not the working copy: e.g. a temporary detached worktree at HEAD with the staged diff applied, then `--baseline-commit HEAD` inside it, so only findings the commit adds block. Never print matched source lines (rule id, file, line only).
- Pre-push and CI: full scan without baseline must report the three existing findings as known/assessed; decide per finding (Step 1) whether to fix or record it in `SECURITY.md` as assessed with reason — `# nosemgrep` cannot be used.

**Steps:**
- [ ] Step 1: Assess the 3 SSRF findings and the parse error (browser `fetch` in the Mini App is not server-side SSRF; daemon pairing URL comes from user config; smoke script is dev-only) — fix where a real allowlist/validation is cheap, otherwise document.
- [ ] Step 2: Tests first in `scripts/security/check.test.mjs`: a staged file adding a known-High pattern (from the rules file, synthetic) is blocked; the same pattern already in HEAD is not blocked; `# nosemgrep` on the new line does not suppress; output contains no source text.
- [ ] Step 3: Implement; `npm run security:test` and `npm run security:check` pass.
- [ ] Step 4: Commit through the hook `chore(security): Semgrep SecObserve gate`.

---

### Task 23a: Make `tests/e2e/virtualization.spec.ts` pass reliably

Found in Task 20: the mobile `virtualization.spec.ts` fails 3/3 when run alone, also at baseline `505c8a7` (Task 7 saw it pass alone in 24 s under a 30 s timeout, so it is load/timing sensitive). `npm run check:frontend` must be green for every frontend task.

- [ ] Step 1: Reproduce alone and under load; capture the Playwright trace of a failing run.
- [ ] Step 2: Root cause with superpowers:systematic-debugging (slow fixture generation, a wait on a fixed timeout, a real virtualization bug). Evidence, not guesses.
- [ ] Step 3: Fix the root cause. Raising a timeout is acceptable only if the trace proves the work is legitimately slow and bounded; never weaken or delete an assertion.
- [ ] Step 4: 5/5 passes alone and the full `npm run test:e2e` passes; commit `fix(e2e): stabilize virtualization spec` through the hook.

---

### Task 23: Mini-app styles on Tailwind, not global CSS classes

User finding 2026-10-19: the Mini App styles most components with plain global CSS classes although Tailwind v4 is installed and `apps/mini-app/AGENTS.md` makes Tailwind tokens the styling system. Measured: 24 `.css` files, ≈2 000 lines, 123 global class selectors (`.muted`, `.notice`, `.status`, `.attachment-description`, …) mostly under `src/app/styles/**` plus `entities/session/ui/changes/session-changes.css`; of 217 `className=` uses in 68 `.tsx` files only ≈51 are Tailwind utilities. No Sass is installed. Ruling: Tailwind utilities (with the existing `cn`/`tailwind-merge` helper and shadcn primitives) — not SCSS modules — because Tailwind v4 + tokens is already the declared system; adding Sass would create a second one.

**Files:**
- Modify: every `.tsx` that uses a global class from `src/**/*.css`; move styling into Tailwind utility classes using the tokens in `src/app/styles/tokens.css` (no hardcoded colors, dark mode and Telegram theme preserved). Repeated combinations become a component in `shared/ui` or a `cva` variant if `class-variance-authority` is already installed; otherwise a small typed helper in the owning slice.
- Delete: the migrated `.css` files.
- Keep (allowlist): `src/app/styles/globals.css`, `src/app/styles/tokens.css`, and styles for HTML the app does not render as JSX (rendered Markdown, `chat/markdown.css`), which may stay as element selectors scoped under one root class inside `@layer components`.
- Modify: `scripts/check-frontend-structure.mjs` — fail on any `.css`/`.scss` file under `apps/mini-app/src` outside the allowlist; `tests/frontend-structure-path.test.ts` (or a new test next to it) covers it.

**Steps (split in two commits to keep reviews small):**
- [ ] Step 1: Allowlist check test first — a fixture with `src/features/x/ui/x.css` is reported; allowlisted files are not. Run: FAIL.
- [ ] Step 2: Visual baseline — capture screenshots of every Storybook story (light and dark, the iPhone 13 viewport used by e2e) with Playwright into the lane's scratch directory (not committed).
- [ ] Step 3 (commit A `refactor(mini-app): layout, controls, sessions and menus on Tailwind`): migrate `layout.css`, `controls.css`, `responsive.css`, `sessions.css`, `menus/**`, `session-changes.css`.
- [ ] Step 4 (commit B `refactor(mini-app): chat views on Tailwind`): migrate `chat/**` except `markdown.css`, plus `pairing.css`, `short-viewport.css`; enable the allowlist check.
- [ ] Step 5: Re-capture screenshots and diff against the baseline (pixel diff, report every story whose diff exceeds 0.1 %); fix unintended differences; list intended ones in the report.
- [ ] Step 6: `npm run check:frontend` exit 0 after each commit; commits through the hook.

---

## Self-review notes

- Coverage: finding 1 → Task 3 (+lint lock); finding 2 → Tasks 6–7 (+lint lock); finding 3 → Tasks 8–12; finding 4 → Tasks 4–5 (+structure gate); finding 5 → Tasks 1–2.
- Not covered on purpose: line-length limits for backend files (`binding.ts` 840, `monitor.ts` 704 lines). The user did not ask for them; the structure gate only counts files. Add a size rule later if wanted.
- Unknowns flagged for the executor: Task 1 Step 5 stages after `build` were never reached before; Task 2 root cause is undiagnosed; Task 8 records body-parser error responses empirically.
