# Frontend architecture and quality gates

The Mini App uses Feature-Sliced Design with enforced architecture and quality gates. Its authoritative instructions are `apps/mini-app/AGENTS.md`.

## Structure

`apps/mini-app` is a separate pnpm workspace with its own manifest and frontend dependencies.

- `src/app`: composition, providers, application coordination and global/token styles.
- `src/pages`: sessions list, selected session and sign-in views. Page-specific feed and permission UI stay inside the session page instead of creating single-use cross-layer slices.
- `src/widgets`: reusable application shell.
- `src/features`: pairing, device access and command submission, each with `ui`, `model`, `lib` and `config` where needed.
- `src/entities`: session reducer/selection/cards and device queries.
- `src/shared`: transport, command recovery, Telegram integration and shadcn-style primitives.

Imports only point to lower layers. Slices expose explicit public APIs; no same-layer cross-slice imports. Shared API and Telegram helpers have their own public APIs. The `@/` alias resolves frontend source; `@protocol` resolves the existing shared Zod wire contract. Story-only aliases resolve synthetic fixtures and helpers and are excluded from the runtime TypeScript build.

## Enforced boundaries

ESLint rejects explicit `any`, files over 200 lines, multiple function or arrow component declarations, multi-directory relative traversal, literal test IDs and assertion APIs in stories. React hook rules and Fast Refresh rules also run. Test selectors use constants and `data-*` identity attributes; E2E assertions remain in spec files.

The reference project's `padding-line-between-statements` configuration is shared by frontend and E2E lint through `eslint/readability.mjs`, with import-block separation added. It requires blank lines around multiline statements, effects, handlers and returns. `npm run lint:fix` applies the rule automatically; normal lint and the guarded build reject violations. Files that grow beyond 200 lines must be decomposed, not compressed by deleting separators.

Steiger checks FSD imports, slice public APIs and segment placement. The structure checker rejects more than six non-index files per slice folder, unsupported source-root folders, files over 200 lines and hex/RGB/HSL/OKLCH/named colors and Tailwind palette utilities outside theme tokens. Knip checks unused files, exports, types and frontend dependencies. Prettier uses the reference project's formatting style and LF line endings.

`npm run build` runs `check:frontend:source` before compilation, so failed quality gates block the normal production build. React Doctor scans the complete frontend with warnings blocking, telemetry and external supply-chain requests disabled. The source has no blanket lint exemptions.

## State and ownership

HTTP device data uses TanStack Query with explicit endpoint keys and no automatic mutation retries. Ordered WebSocket events keep the bounded session reducer; command submission keeps the original command ID across uncertain HTTP delivery. Logout clears the query cache, invalidates the connection epoch and prevents late responses from restoring owner data. Drafts are keyed by session ID; delayed command completion only clears the originating unchanged draft. Pairing polling stops after pairing, logout or unmount.

Each mounted application owns a Zustand vanilla session store. The existing pure reducer applies ordered frames inside that store; selectors expose session data, connection state and command feedback. Reset clears these values together on logout or authentication expiry. Transport instances, connection epochs and DOM gesture references remain outside reactive state. A separate bounded Zustand store holds reading positions and notifies the authenticated bookmark synchronizer only about local changes. Remote bookmark hydration does not echo a write back to the server.

`SessionProvider` owns the store and its stable `TransportRuntime` service. Feature hooks read the scoped store and runtime through context instead of accepting transport or epoch refs. The shared runtime context allows lower-layer API hooks to use that same instance without importing a peer entity. Each operation captures a connection lease; logout and authentication expiry invalidate it before clearing owner data, preventing stale completions from changing the next session. Device reset reads the current connection status when invoked.

Component contracts live in adjacent `*.types.ts` files or the slice's `model/types` directory. ESLint rejects multi-field inline object types in named, arrow and memo component signatures. Intrinsic React prop aliases remain supported.

Reading positions contain a stable message ID, pixel offset and optional native history cursor. Browser storage provides immediate restoration, while authenticated PostgreSQL records with a Redis read cache preserve positions across browser contexts. Opening a session loads the window around its saved position; a session without a bookmark starts with the latest messages. Older and newer pages load as the reader approaches the relevant edge.

Components render; lifecycle and mutation code live in model hooks. Shared primitives forward test attributes. Colors come from Telegram-aware theme tokens, with light/dark defaults. Loading placeholders share the session-card geometry. The Vite/Telegram runtime remains appropriate here; the reference application's Next.js, Azure authentication and C# API integrations are project-specific.

## Conversation rendering

Message content uses `react-markdown`, `remark-gfm` and `rehype-highlight`. Raw HTML is disabled, unsafe URL protocols are filtered, and remote images become explicit links. Code controls copy the exact rendered code text. Terminal snapshots remain literal text.

The session feed uses `@tanstack/react-virtual` with stable message IDs, measured variable heights and three overscan rows. Fractional heights preserve alignment between rendered cards and navigation markers. End anchoring preserves the visible message when earlier history changes or the oldest message leaves the 500-message buffer. Message bodies and the navigation rail are memoized separately. Rail jumps work for unmounted rows; hover and keyboard focus show one shared preview.

The selected session uses a compact viewport layout with a flexible feed and a bounded composer. Empty-device queries poll while the authenticated pairing screen is open, so confirmation through the bot does not require reloading the Mini App.

## Checks

From repository root:

```sh
npm run check:frontend
npm test
npm run build-storybook
```

`check:frontend` runs typecheck, the guarded production build, Storybook browser/a11y scenarios and real-relay mobile Playwright tests. Individual gates are available as `lint`, `lint:fsd`, `lint:structure`, `lint:react`, `format:check` and `knip`.

Storybook fixtures are synthetic. MSW handles only `http://api.storybook.local`; unexpected requests to that origin fail. No Telegram identity, production token or authentication bypass is embedded in product code. Story `play` functions contain interactions only; assertions live in test/spec files. The guard tests deliberately feed invalid files to the real lint/structure commands.

## Language

The RU/EN switch lives next to Sign out. Typed dictionaries live in `shared/lib/i18n/dictionaries`. `i18next` handles translation and standard `{{variable}}` interpolation; `react-i18next` supplies `I18nextProvider` and reactive translation hooks. Each provider owns a synchronously initialized instance with bundled resources, keeping Storybook languages isolated. Shared hooks handle locale preference and document language; there is no custom translation engine. UI feedback is stored as machine codes and translated during rendering, so existing alerts and receipts follow a language change. The first language comes from the saved preference, Telegram locale or browser locale, with Russian as the fallback. The versioned browser-local preference is scoped to the Mini App origin; a new Quick Tunnel hostname has separate storage. Storage denial does not disable switching. Messages, terminal text, tool names and permission JSON are preserved verbatim. Language changes do not recreate the authenticated transport or reset session drafts.

## Agent providers

The wire protocol and Mini App distinguish Codex CLI and Mac app targets by `threadId`, alongside existing Claude targets. Codex never borrows `claudeSessionId`. Session cards/details derive identity from the source, assistant messages use the selected provider name, and generic UI copy and receipts support both agents. Runtime capability flags still determine which controls appear. Codex fixtures exercise UI and relay compatibility only; an actual Codex adapter is tracked separately in `docs/superpowers/plans/2026-10-16-codex-support.md`.

## Prompt outbox and command receipts

The application session store owns a bounded in-memory prompt outbox (20 entries, 80 MiB of attachment files). The composer stays editable while a verified source is running; its messages wait in FIFO order per session. Unsent entries can be removed. A fresh source lifecycle releases the next message; UI message revisions cannot release that barrier. Device, stream, binding generation and runtime epoch fence every queued intent. Logout, expiry and device reset clear the outbox. Closing/reloading the application does not retain this in-memory queue.

Accepted commands are reconciled through GET-only status reads. Failed reads retain accepted state. Unknown commands require an explicit check or retry of their original ID and pause only that session's prompt lane. Controls use separate command lanes, so a pending answer does not disable typing or interrupt. Question receipts match the original turn, question and exact answer; an accepted native receipt can confirm delivery after IPC acknowledgement loss. Raw machine error literals are centralized in the protocol `ErrorCode` object; a source guard prevents new frontend literals.

The Changes panel displays bounded native Codex file-edit patches already received through owned thread history/events. It provides syntax highlighting, add/delete lines and hunk line numbers. It does not read arbitrary filesystem paths or reconstruct current Git changes. Snapshot budgets reserve space for existing terminal and permission data; omitted patches are explicitly marked.
