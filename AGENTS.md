# Workspace instructions

- Create commits only when the user explicitly requests them. Never push without explicit authorization.
- Define owned states, statuses, actions and discriminants in dedicated named `as const` objects with derived union types. Reuse their members in schemas, assignments and comparisons; do not duplicate inline string unions or domain literals. Shared wire vocabulary belongs in `packages/protocol/src/values/`; provider-specific vocabulary stays in its domain module.
- Keep responses terse and concrete; preserve technical details.
- Follow the plans and specifications linked from README.md. Creating this repository does not authorize implementing or deploying the application.
- Support multiple users with ownership checks on every data and command path.
- cmux is optional. Keep Claude Desktop Chat, Desktop Code, native CLI and managed PTY capabilities distinct.
- Never claim Desktop Chat Accessibility integration works before verifying it against the actual application.
- Never import or call `expect` or any assertion API in `*.stories.*`. Storybook play functions may only perform interactions; assertions belong in test/spec files.
- Never store secrets, tokens, real chat content or terminal recordings in version control.
- Before publication, run `npm run security:check` and `npm run security:test`. Install the checked-in Git hooks with `npm run security:install-hooks`; do not bypass findings. README screenshots must come from reviewed English Storybook fixtures, never real sessions. See `SECURITY.md`.
- Run `npm run validate` without creating a commit. Pre-commit must validate the actual staged snapshot with `npm run validate:commit`; never bypass hooks or validate only the working copy for a commit.
- Frontend changes must follow `apps/mini-app/AGENTS.md` and pass `npm run check:frontend`; the guarded build enforces source-quality gates.
