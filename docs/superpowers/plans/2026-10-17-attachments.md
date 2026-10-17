# Attachments Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline for shared protocol/relay; independently delegate page-story completion and frontend/companion work with this exact contract. User authorizes implementation without approval pauses. Never commit.

**Goal:** Send/view files/images through Mini App and cover every page/state in Storybook.

**Architecture:** Owner-scoped private PostgreSQL blob transfer, protocol descriptors and source capability gates; companion verifies/downloads files and maps exact native inputs; FSD composer/viewer consumes authenticated blob APIs. Existing relay/command dedup stays authoritative.

**Tech Stack:** TypeScript, existing Express/Nest/PostgreSQL, React/i18next/TanStack, Storybook/MSW/Vitest/Playwright; no paid storage or new model key.

**Spec:** docs/superpowers/specs/2026-10-17-attachments-design.md

## Task1 — Shared descriptor and validation

- [x] RED protocol tests for media-only prompts/history, bounds, duplicate IDs and forged paths.
- [x] Add packages/protocol/src/attachments.ts and extend schemas/exports; preserve text-only compatibility.
- [x] GREEN contract tests, typecheck baseline.

## Task2 — Relay storage and transfer

- [x] RED real PostgreSQL/HTTP tests for binary JSON/image/file bodies, exact scope, revoke, quota, duplicate uploads and MIME safety.
- [x] Add apps/server/src/attachments/{service,routes,content}.ts and table/index migration; mount before JSON parsing; enforce command descriptors via canonical lookup.
- [x] GREEN full tests and source permissions.

## Task3 — Companion and sources

- [x] RED download hash/path/race, native input mapping, source capability and history media tests.
- [x] Add daemon attachments modules; extend adapter/dispatcher and existing Codex/Claude drivers and transcript export. Apply explicit limits to source media.
- [x] GREEN tests; dedicated real source image/file acceptance where available.

## Task4 — Composer, viewer and page stories

- [x] Complete every current page and real visual state in isolated Storybook.
- [x] RED browser contracts for selecting/removing/sending image/file, image-only, image viewer/file download, errors, auth/revoke and capability gates.
- [x] Add entity attachment view and feature send-command transfer model; keep all FSD/file-size/source gates and RU/EN states.
- [x] Add reusable attachment Storybook states; never story assertions or live endpoints.

## Task5 — Delivery

- [x] Run npm test, npm run check:frontend, build-storybook and appropriate package verification; inspect synthetic mobile images.
- [x] One fresh final review of the integrated change; fix important findings with regressions.
- [x] Update docs/coverage/status, rebuild personal service preserving pairing and verify public bundle/health/WSS. No commits.
