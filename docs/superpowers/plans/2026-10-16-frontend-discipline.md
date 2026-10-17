# Frontend Discipline Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. No commits. The user explicitly requested implementation without repeated approval gates.

**Goal:** Apply the reference frontend's architecture and automated quality gates to the Telegram Mini App.

**Architecture:** Keep the existing Vite/Telegram runtime and protocol. Apply FSD layers (`app`, `pages`, `widgets`, `features`, `entities`, `shared`), slice public APIs, colocated UI/model/api/lib/config, and absolute aliases. HTTP device state uses TanStack Query; ordered WebSocket events keep their existing reducer and command deduplication.

**Reference:** `apps/mini-app/AGENTS.md`, `docs/frontend-architecture.md`, and the repository ESLint/Steiger/knip/Storybook configuration.

## Global Constraints

- Maximum 200 lines per frontend source/test/config file; one component per file; maximum six non-index files per slice directory.
- No upward or same-layer cross-slice imports. Hooks belong in `model/`; pure transformations belong in `lib/` or `model/`.
- Strict TypeScript, no explicit `any`, tokens for colors, shared primitives, test-id constants only. Story play functions contain interactions only; assertions belong in spec files.
- New developer documentation/comments are English; preserve the existing Russian product interface.
- No production authentication bypass, real user fixtures, tokens or chat content. Never copy project-specific Azure/C# integrations or operate the reference project's services.

## Review Focus

Logout must clear query data, stop polling and reject late responses. Reconnect must preserve bounded streaming history. Command retries must retain commandId. Stories cannot reach production APIs. Directory checks must reject oversized files and prohibited imports rather than merely documenting them.

## Tasks

- [x] Move transport/protocol/Telegram utilities to shared, session state to entities, then update tests and aliases. Existing reducer/recovery/dedup tests must pass.
- [x] Split App into page/widget/feature components and model hooks. Add shared primitives, theme tokens, loading skeletons and test-id constants. Existing user-flow E2E tests must pass after using test-id selectors.
- [x] Add ESLint, Prettier, Steiger, structure checks, knip, Storybook/MSW and browser tests. Run each gate; verify deliberately invalid temporary fixtures fail lint/structure.
- [x] Build isolated stories for reusable components and pages. Interaction-only play functions; test behavior in specs. Verify static Storybook build and browser suite.
- [x] Rebuild app and restart the personal launcher with the user's configured token. Verify public HTTPS, bot menu URL and local relay; pairing remains an explicit local owner confirmation.

Final review: one fresh read-only review, one fix pass. Session-scoped drafts and session-fenced completion, arrow-component linting and token-only palette/CSS checks were reproduced RED and fixed GREEN. No commits or pushes.
