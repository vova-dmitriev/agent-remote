# Codex Structured User Input Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for root integration; independent daemon and frontend work follows the fixed contract below. User explicitly authorized continuous implementation; no commits.

**Goal:** Answer pending Codex questions from Mini App with an explicit selected option, custom text, or Skip; the native owner receives exactly the original structured request response.

**Architecture:** Extend existing owner-scoped snapshot/command transport with optional `userInputs` and optional capability `userInput`. A local broker holds ephemeral requests and validates submissions before the native callback. Existing permission and prompt actions retain their behavior; question answers never become a new chat prompt. Codex CLI responds to item/tool/requestUserInput; Desktop uses the exact installed follower IPC method after verifying its schema.

**Tech Stack:** TypeScript, Zod, React, existing PostgreSQL command audit, native Codex app-server/IPC, Playwright/Storybook.

**Design:** The native screenshot defines the UI intent. Show compact pending-question cards above the composer, options and optional custom text, explicit Send and Skip. Support multiple questions, secret-input masking, native resolution/removal, reconnect and source generation fencing. Use safe Markdown; preserve original history. No answer is selected/submitted automatically. An expired or already resolved request cannot receive a remote response.

## Contract

- `capabilities.userInput?: boolean` enables question answers independently from idle prompt submission.
- `snapshot.userInputs?: PendingUserInput[]`, default consumption `[]`, preserves old producers.
- `PendingUserInput`: `{requestId,sessionId,generation,turnId,itemId,questions,isBlocking,expiresAt}`.
- Question: `{id,header,question,isOther,isSecret,options: {label,description}[] | null}`.
- Action: `{type:'user_input',requestId,answers:Record<questionId,{answers:string[]}>}`. Empty `answers:{}` explicitly skips. Otherwise every question needs one valid option or allowed custom answer.
- Shared schemas/helper in `packages/protocol/src/user-input.ts`; root owns protocol and server relay changes.
- Daemon `UserInputBroker` owns ephemeral pending leases and one-shot async delivery callback; `submit(requestId,generation,answers)` validates, claims once, awaits native callback. Unknown writes stay unknown and are never automatically retried. Broker expiry/cancel never answers/skips the native question.
- Desktop native reply may be asynchronous; adapt CodexClient.respond to `void | Promise<void>` where necessary. Do not report dispatched before native transport acknowledgement.
- Remote input enabled gate applies. Relay and daemon both enforce owner/device/session/generation/capability/expiry/current question and answer validation. Native resolved/turn lifecycle/disconnect clear obsolete requests.

## Tasks

- [ ] Protocol and relay: write schema/ownership/stale-answer regressions, see RED, implement bounded schemas and guarded command path; keep offline snapshots safe.
- [ ] Daemon: write broker and native Codex lifecycle regressions, see RED, implement capture, replay of pending snapshot requests, validated native submission/Skip, fencing, cancellation and uncertain receipt behavior.
- [ ] Frontend: write interaction regression, implement FSD question cards/state, selectors, RU/EN copy, safe error translations and synthetic stories, no assertions in stories.
- [ ] Integrate meaningful native-protocol browser E2E for CLI/Desktop choices/free text/Skip/local resolution/stale ownership/reconnect; no commands sent to real conversations.
- [ ] Run root suite and complete frontend gates, independent review, package/archive, controlled deployment and public/pairing verification. Update operational docs and explain any actual native boundary accurately.
