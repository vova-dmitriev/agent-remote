# Frontend rules

- Follow Feature-Sliced Design: shared → entities → features → widgets → pages → app. Import only lower layers; slices on the same layer never import each other.
- Each slice exposes an explicit index.ts public API. Inside a slice use local imports; outside it use the public API through @/. The @protocol alias is the shared wire contract.
- Maximum 200 lines per source/test/config file, including blanks. Maximum six non-index files per slice directory. One component per file; put a component's parts/stories together when they grow.
- Components render. State, loading, mutations and multi-step interactions belong in model/use-*.ts; pure transformations in lib/ or model/. No dumping grounds named components/, hooks/, utils/, store/ at src root.
- HTTP server state uses TanStack Query, ordered WebSocket events use the bounded session reducer. No automatic mutation retries. Logout clears the query cache and closes/invalidates all in-flight work.
- Strict TypeScript; no any. Import external modules, then @ aliases, then relative imports. No multi-directory relative traversal.
- Separate logical blocks with blank lines: after imports and declarations, around effects, multiline statements and handlers, and before return. ESLint enforces the reference project's `padding-line-between-statements` rules. Run `npm run lint:fix` from the repository root to apply them; do not remove blank lines to fit the 200-line limit.
- Shared shadcn primitives live in shared/ui. Tailwind v4 uses CSS tokens in app/styles/tokens.css; no hardcoded colors in components. Support Telegram theme changes and dark mode. Lucide icons only.
- Every component root and interactive/asserted element has a static data-testid from the slice's config/test-ids.ts. Repeated rows use one static id plus data-* identity attributes. Shared primitives forward attributes.
- Tests use getByTestId constants, never role/text/label/CSS queries. Accessibility roles/labels remain in product UI.
- Every reusable component gets a Storybook story with synthetic fixtures. MSW targets only the isolated story API origin. No live tokens, user chats, auth bypass or real backend calls in stories.
- Never import or call expect or an assertion API in _.stories._. Play functions perform interactions only. Assertions belong in _.test._ or _.spec._.
- Required checks: npm run lint, lint:fsd, lint:structure, format:check, knip, typecheck, build, test-storybook, test:e2e (from repository root).
- New code comments and developer docs are English. Product copy supports Russian and English; UI text belongs in shared/lib/i18n/dictionaries, not components. Preserve user messages and terminal text verbatim. Files use LF. Create commits only when explicitly requested by the user.

Reference: the self-contained architecture and quality gates in this file and `docs/frontend-architecture.md`.
