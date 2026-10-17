# Desktop user-message identity repair

The observed user commands were dispatched once each. Desktop first exposes a synthetic `turn-input` from turn parameters, then publishes the canonical user item with a different native ID. Both IDs reach persistent history and render as separate messages.

- [x] Reproduce the transition with real Desktop normalization and message upsert; preserve repeated prompts and same-turn steering.
- [x] Keep the initial Desktop user item on the stable per-turn identity; leave subsequent user inputs and CLI IDs distinct.
- [x] Verify tests/build and controlled Desktop runtime E2E.
- [x] Repair only historical aliases confirmed by the owning Desktop's canonical first items, scoped to the paired owner/device/session. Preserve native originals and genuine later inputs.
- [x] Refresh the running personal service, verify public health/pairing and absence of the observed duplicate IDs. No commits.

Evidence: the initial regression tests failed before normalization, then passed. All 333 unit/integration cases and the five targeted CLI/Desktop runtime browser cases passed. The owning Desktop read confirmed all six completed turns retain input parameters. Eight canonical aliases were normalized in 20 PostgreSQL and 20 local SQLite event records, preserving event IDs, sequence numbers, text and native files. A repeated dry run matched zero remaining aliases. Owner-scoped history now contains one instance of each prompt from the screenshot. No command resend or text-based deduplication was introduced.

Final verification: 89 mobile E2E scenarios, 148 Storybook browser cases, TypeScript, source gates and production build passed. The refreshed personal service passed public/local health, current bundle, bot menu, WebSocket, pairing fingerprint and companion heartbeat checks. The authenticated history check still found zero old aliases and one of each reported prompt after native discovery resumed. The companion archive passed verification. Existing open Mini App views need closing and reopening to discard previously loaded aliases.
