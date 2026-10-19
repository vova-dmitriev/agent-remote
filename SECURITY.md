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
- Semgrep runs after Gitleaks in `security:staged` and `security:check` (worktree mode) with the vendored `.semgrep/secobserve-high.yml` (17 High/Critical JavaScript/TypeScript rules selected from the team's SecObserve ruleset for the technology used here: Node.js core, Express, Electron, `pg`, Playwright; the header records source path, checksum and filter). It runs from the official `semgrep/semgrep` image pinned by digest in `scripts/security/semgrep.mjs`, with no network and no Python toolchain; without Docker the step fails with "Semgrep requires Docker. Scan did not run." The flags are `--disable-nosem --error --metrics=off --disable-version-check --quiet --skip-unknown-extensions`, so `# nosemgrep` comments do not suppress anything. Staged mode scans the index (changed files only, with `--baseline-commit HEAD` against their HEAD versions), so only findings a commit adds block it; worktree mode and CI scan everything. Output lists only rule id, path and line.
- Semgrep findings that were reviewed and accepted live in `scripts/security/semgrep-assessed.mjs`, keyed by rule, file and a fingerprint of the matched lines (whitespace-normalised SHA-256 prefix; a test checks the file and rule still exist, and a second finding of the same rule in the same file is blocked). All three are `rules_lgpl_javascript_ssrf_rule-node-ssrf`: `apps/daemon/src/cli/pairing/connect.ts` (the relay origin passes `validateRelayUrl` before use, which the rule cannot see), `apps/mini-app/src/shared/api/request-error.ts` (a browser `fetch` to the app's own API origin, not a server-side request) and `scripts/smoke-image.ts` (developer script requesting the loopback port of a container it started). Any new finding, or a finding in another file or at changed code, fails the gate and must be fixed or assessed here.
- The pre-commit hook additionally runs `validate:commit` on an isolated full-index snapshot: hook regressions, TypeScript, all guarded-build quality checks and unit/integration tests, including a fresh ad-hoc helper build on macOS. It preserves unstaged work and fails closed when checks or dependencies are unavailable. Run `npm run validate` for equivalent working-copy checks without committing. Test PostgreSQL/Redis must be available through `compose.test.yml`.
- The pre-push hook and GitHub workflow repeat the checks. CI fetches full history, verifies the pinned Gitleaks release archive against its published checksum and pulls the digest-pinned Semgrep image. CI runs after upload; it cannot prevent the initial upload.

Do not bypass failed checks or hide findings with broad exclusions. Replace sensitive examples with unmistakable fixture values, and inspect binary media manually. Hooks and scanners cannot guarantee detection of every secret or private message. Enable the hosting provider's secret scanning and push protection before publication, and require the repository safety workflow for protected branches.

## If sensitive data is found

Stop publication. Remove it from proposed changes and rotate exposed credentials at their provider. Deleting a file from the latest revision does not remove earlier copies in Git history. History rewriting and remote cleanup require a separate, explicit recovery procedure; do not rewrite history or delete repositories automatically.

Report vulnerabilities privately to the repository owner. Do not put credentials, real chat text or unredacted logs in public issues. There is no public security reporting address configured in this source tree.
