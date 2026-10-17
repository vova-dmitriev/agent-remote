# Repository security

Never commit tokens, authentication payloads, API keys, account profiles, device state, real conversations, screenshots of real sessions, terminal recordings or database exports. Use `.env.example` and synthetic test fixtures; keep runtime files in ignored private directories. The companion's credentials belong on the Mac, not in the Mini App or its build output.

## Local checks

Install Gitleaks (`brew install gitleaks` on macOS), then run:

```sh
pnpm security:install-hooks
pnpm security:check
pnpm security:test
```

The hook installation sets the clone-local `core.hooksPath` to `.githooks`. Inspect any existing hook configuration before replacing it in another clone. Hooks are not installed automatically by dependency installation. Validation never creates commits; actual commits require an explicit user request.

- `security:staged` exports the Git index to a temporary directory and scans the staged bytes, even if the working copy has changed afterward. Private/generated paths, symlinks and submodules require removal or explicit policy review.
- `security:check` scans tracked and nonignored untracked working files, then all reachable commits. It rejects private/generated paths in reachable history, including files later deleted.
- Gitleaks runs with upstream detectors plus a Telegram token detector, full redaction, no project-wide allowlists and no baseline. Scanner output includes only rule IDs, paths and line numbers; temporary copies and reports are removed on completion.
- The pre-commit hook additionally runs `validate:commit` on an isolated full-index snapshot: hook regressions, TypeScript, all guarded-build quality checks and unit/integration tests, including a fresh ad-hoc helper build on macOS. It preserves unstaged work and fails closed when checks or dependencies are unavailable. Run `npm run validate` for equivalent working-copy checks without committing. Test PostgreSQL/Redis must be available through `compose.test.yml`.
- The pre-push hook and GitHub workflow repeat the checks. CI fetches full history and verifies the pinned Gitleaks release archive against its published checksum. CI runs after upload; it cannot prevent the initial upload.

Do not bypass failed checks or hide findings with broad exclusions. Replace sensitive examples with unmistakable fixture values, and inspect binary media manually. Hooks and scanners cannot guarantee detection of every secret or private message. Enable the hosting provider's secret scanning and push protection before publication, and require the repository safety workflow for protected branches.

## If sensitive data is found

Stop publication. Remove it from proposed changes and rotate exposed credentials at their provider. Deleting a file from the latest revision does not remove earlier copies in Git history. History rewriting and remote cleanup require a separate, explicit recovery procedure; do not rewrite history or delete repositories automatically.

Report vulnerabilities privately to the repository owner. Do not put credentials, real chat text or unredacted logs in public issues. There is no public security reporting address configured in this source tree.
