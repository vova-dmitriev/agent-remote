# Source quality

`npm run lint` checks the Mini App, browser tests, daemon, server, shared packages, scripts and root JavaScript/TypeScript configuration. The guarded production build also checks source formatting. Generated output and private runtime artifacts are excluded.

Node source uses the shared logical-block spacing rules, strict TypeScript linting, braces around conditional bodies and one statement per line. Fixed limits and timings live in domain-specific configuration modules. Internal error and activity categories use named enums; shared wire values use named readonly lists so their existing serialized values remain compatible.

From the repository root:

```sh
npm run lint:fix
npm run lint:source
npm run format:source:check
npm run typecheck
```

`lint:source:fix` runs formatting and ESLint autofixes to a stable result, then verifies both. `lint:daemon`, `lint:daemon:fix` and `format:daemon:check` provide a narrower daemon workflow.

The Mini App keeps its own formatting configuration. Run its Prettier commands from `apps/mini-app`; the root formatter deliberately ignores frontend files. Frontend module-size, FSD, static test-ID and Storybook rules remain enforced independently.

Component signatures use named props contracts from separate type files. The `frontend/named-props` rule rejects multi-field inline object contracts, including arrow and memo components. Runtime hooks consume the application-scoped store and transport service through context; React refs are retained for local DOM or transient interaction state.
