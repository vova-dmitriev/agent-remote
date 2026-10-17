# Chat usability implementation

Goal: simplify personal Mac connection and make remote conversations readable and navigable.

1. Add a reusable safe Markdown renderer with GFM, code highlighting, code copy, localized controls and isolated stories. Keep terminal output literal. Disable raw HTML and automatic remote images.
2. Simplify pairing: personal startup opens Telegram with a short-lived pairing deep link; the authenticated private bot sender claims it; one local confirmation completes it. Preserve ownership, expiry and proof checks. Keep manual code entry as a fallback. Existing paired installations reconnect without pairing again.
3. Add a virtual message list using `@tanstack/react-virtual`, a message rail, current-message marker, accessible keyboard navigation and a bottom button. Measure variable Markdown heights, keep a small overscan and stable message keys. Preserve the visible message and its offset across earlier-row updates and the 500-message eviction boundary; follow new messages only when at the bottom. Keep navigation inside the feed.
4. Cover behavior with synthetic tests and run the full frontend checks and unit suite. Review changes, rebuild and restart the existing personal service if backend changes require it.

Ownership: Markdown worker owns shared/ui/markdown, its hook/styles/tokens and frontend dependencies; pairing worker owns backend/CLI onboarding and unit tests. Parent owns feed, pairing UI, dictionaries, integration and E2E.

Constraints: no commits; no real chat fixtures or tokens; no live messages/dialogs in tests; preserve current paired device. Source files remain under 200 lines and six non-index files per directory. Product copy is RU/EN.

Review acceptance: an already open unpaired Mini App discovers bot-driven pairing without reload. E2E proves a bounded DOM with 500 messages, distant marker jumps, dynamic-height updates, eviction anchoring and bottom following.
