# Repository security

Never commit tokens, authentication payloads, API keys, account profiles, device state, real conversations, screenshots of real sessions, terminal recordings or database exports. Use `.env.example` and synthetic test fixtures; keep runtime files in ignored private directories. The companion's credentials belong on the Mac, not in the Mini App or its build output.

## Local checks

Install Gitleaks (`brew install gitleaks` on macOS) and start Docker (used for Semgrep), then run:

```sh
pnpm security:install-hooks
pnpm security:check
pnpm security:test
```

The hook installation sets the clone-local `core.hooksPath` to `.githooks`. Inspect any existing hook configuration before replacing it in another clone. Hooks are not installed automatically by dependency installation. Validation never creates commits; actual commits require an explicit user request.

- `security:staged` exports the Git index to a temporary directory and scans the staged bytes, even if the working copy has changed afterward. Private/generated paths, symlinks and submodules require removal or explicit policy review.
- `security:check` scans tracked and nonignored untracked working files, then all reachable commits. It rejects private/generated paths in reachable history, including files later deleted.
- Gitleaks runs with upstream detectors plus a Telegram token detector, full redaction, no project-wide allowlists and no baseline. Scanner output includes only rule IDs, paths and line numbers; temporary copies and reports are removed on completion.
- Semgrep runs after Gitleaks in `security:staged` and `security:check` (worktree mode); see [Semgrep](#semgrep).
- The pre-commit hook additionally runs `validate:commit` on an isolated full-index snapshot: hook regressions, TypeScript, all guarded-build quality checks and unit/integration tests, including a fresh ad-hoc helper build on macOS. It preserves unstaged work and fails closed when checks or dependencies are unavailable. Run `npm run validate` for equivalent working-copy checks without committing. Test PostgreSQL/Redis must be available through `compose.test.yml`.
- The pre-push hook and GitHub workflow repeat the checks. CI fetches full history, verifies the pinned Gitleaks release archive against its published checksum and pulls the digest-pinned Semgrep image. CI runs after upload; it cannot prevent the initial upload.

## Semgrep

- Rules: the vendored `.semgrep/secobserve-high.yml` holds 17 High/Critical JavaScript/TypeScript rules selected from the team's SecObserve ruleset for the technology used here (Node.js core, Express, Electron, `pg`, Playwright); its header records source path, checksum and filter.
- Runtime: the official `semgrep/semgrep` image pinned by digest (`SEMGREP_IMAGE` in `scripts/security/semgrep.mjs`; CI pulls the same constant). No Python toolchain. The container runs with `--pull=never --network none --read-only --cap-drop ALL`, as the calling user, with the scanned copy mounted read-only. A missing image is pulled once by digest; if Docker is unavailable or the pull fails, the step fails ("Scan did not run.") instead of passing.
- Flags: `--disable-nosem --error --metrics=off --disable-version-check --quiet --skip-unknown-extensions --timeout 0`. `# nosemgrep` comments suppress nothing. Any Semgrep error other than a partial parse (for example a timeout) fails the scan as incomplete. Semgrep's default ignore list applies in every mode (for example `tests/` and `build/` directories are skipped).
- Staged mode scans the Git index, not the working copy: the changed files' staged bytes in a throwaway repository whose commit holds their HEAD versions. A plain scan of that tree selects targets with the same default ignores as a worktree scan; if it finds anything, a scan of those targets with `--baseline-commit HEAD` keeps only the findings the commit adds, and those block it unless assessed (assessed entries are counted against all findings in the staged files, so the verdict matches a full scan). Worktree mode, pre-push and CI scan everything. Output lists only rule id, path and line.

### Assessed findings

Fix a finding when a cheap allowlist or validation exists. Otherwise record it in `scripts/security/semgrep-assessed.mjs` as `{ ruleId, path, fingerprint, reason }`, with a one-line `reason`, and list it below:

1. Run `npm run security:check` and note the reported rule id, path and line.
2. Compute the fingerprint (SHA-256 prefix of the matched source lines, whitespace-normalised): `node --input-type=module -e "import { fingerprint } from './scripts/security/semgrep-assessed.mjs'; import { readFileSync } from 'node:fs'; console.log(fingerprint(readFileSync('<path>', 'utf8'), <start line>, <end line>))"` (the end line is the last line of the match; usually the start line).
3. Add the entry, rerun `npm run security:check` and `npm run security:test`.

Each entry accepts exactly one finding. Moving or re-indenting the code keeps it accepted; editing the matched lines, renaming the file or adding another finding of the same rule in the file (even an identical copy) blocks again.

Current entries, all `rules_lgpl_javascript_ssrf_rule-node-ssrf`:

- `apps/daemon/src/cli/pairing/connect.ts`: the relay origin passes `validateRelayUrl` before use, which the rule cannot see.
- `apps/mini-app/src/shared/api/request-error.ts`: a browser `fetch` to the app's own API origin, not a server-side request.
- `scripts/smoke-image.ts`: developer script requesting the loopback port of a container it started.

Do not bypass failed checks or hide findings with broad exclusions. Replace sensitive examples with unmistakable fixture values, and inspect binary media manually. Hooks and scanners cannot guarantee detection of every secret or private message. Enable the hosting provider's secret scanning and push protection before publication, and require the repository safety workflow for protected branches.

## If sensitive data is found

Stop publication. Remove it from proposed changes and rotate exposed credentials at their provider. Deleting a file from the latest revision does not remove earlier copies in Git history. History rewriting and remote cleanup require a separate, explicit recovery procedure; do not rewrite history or delete repositories automatically.

Report vulnerabilities privately to the repository owner. Do not put credentials, real chat text or unredacted logs in public issues. There is no public security reporting address configured in this source tree.
