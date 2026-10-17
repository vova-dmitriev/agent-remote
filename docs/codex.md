# Codex connections

Start the companion/personal service first. Existing local Codex authentication is reused; no new API key or paid hosting is required.

## Mac application

Open Codex on the Mac. The companion discovers locally owned active desktop chats automatically. To request discovery immediately:

```sh
node /absolute/path/claude-remote/apps/daemon/bin/remote.mjs codex connect desktop
```

To select an exact existing thread:

```sh
remote codex connect desktop THREAD_UUID
```

This attaches to the owning desktop client through its private local IPC socket, rather than opening a second App Server for the stored conversation. Original title, bounded history and subsequent events are read from that owner. No Accessibility permission is needed for Codex.

The installed desktop IPC is internal and versioned: owner discovery v1, stream state v11, start v2, interrupt v4, command/file decision v1. Unknown stream versions are ignored and no ready binding is created without a recognized snapshot. Compatibility was checked against the desktop's bundled Codex `0.162.0-alpha.17.2`; future changes can require an adapter update.

## Ordinary terminal

Run the regular Codex TUI through the wrapper:

```sh
remote codex
remote codex -m MODEL_AVAILABLE_IN_YOUR_ACCOUNT
```

The wrapper starts/reuses a private App Server at `~/.claude-remote/codex/app-server.sock` and starts Codex with `--remote unix://…`. Local terminal input and Mini App commands reach the same owning server. New TUI sessions explicitly use the calling terminal directory; `--cd`/`-C` overrides are preserved and resume/fork retain their original directory. Normal Codex options are forwarded without a shell; a second `--remote` argument is rejected.

An already running terminal can be attached only when its owning server exposes a compatible local Unix control socket:

```sh
remote codex connect cli THREAD_UUID --socket /absolute/private/control.sock
```

The thread must already be loaded by that server. A stored thread ID alone does not establish ownership. For a standalone terminal without a control socket, close its frontend and explicitly resume it using `remote codex resume THREAD_UUID`; do not run two independent writers for the same thread.

CLI `0.149.0` was verified. Its managed-daemon installer was unavailable, so the wrapper uses `app-server --listen unix://…` directly. Socket owner/type and parent-directory permissions are checked. No TCP App Server is exposed. On the checked account, the configured model was absent from the CLI catalog; native probes selected the catalog's default in disposable threads only. Product commands preserve the user's model choice and display a translated unavailable-model error.

## Commands and approval scope

The connector supports existing history/title, text and attachment prompts, streaming assistant messages, stop, one-time command/file allow or deny, local resolution, expiry and reconnect. Images use native local-image inputs; other files use explicit private file references. Supported native media records can be viewed in history. See [attachment transfer and limits](attachments.md). There is no terminal snapshot for App Server sources. Prompts require a verified idle source. Both companion and relay enforce feature flags, owner/device/source identity, generation and command dedup.

Uncertain writes are not retried automatically. Check the original command result before an explicit retry. Pending attachment drafts keep their original command and upload IDs while delivery remains unknown. An allow maps only to `accept`, never a session-wide permission or policy amendment. Expiry leaves the request available in the local owner. Structured tool questions, permission-profile requests, MCP elicitation, realtime and project creation do not have remote UI support and remain in the owning Codex application.

## Verification

From the source checkout:

```sh
npm test
npm run check:frontend
npm run probe:codex
```

The last command is opt-in and calls the installed authenticated Codex model in a newly created disposable workspace/thread. It writes only boolean compatibility results to ignored `artifacts/codex-compatibility.json`, then archives its own thread. It never resumes an existing user conversation. The private server can remain available for later terminal sessions.

Native CLI and desktop acceptance separately verified real answers and original context, exact-turn stop, and a one-time command approval. Desktop approval tests changed policy only in their dedicated disposable thread. No global Codex model, authentication or permission settings were changed. Controlled browser E2E additionally covers both command/file allow/deny, ambiguity, reconnect, stale decisions, cross-owner requests and revoke. See [acceptance](acceptance.md) and [coverage](e2e-coverage.md).

## Session model metadata

Each compact list row shows its actual per-session model, followed by source.
Claude hooks and exact-session assistant transcript records supply the Claude model.
Codex Desktop uses the owning thread's collaboration settings/model; CLI uses its
resume response and exact validated rollout turn-context records. Later model
changes update the existing session without commands or binding regeneration.
Metadata persists through snapshots/cache/local restart. Old or unsupported sources
show a localized unknown-model label; account-wide defaults are never substituted.
Native Desktop metadata was verified read-only. CLI model updates have controlled
protocol/filesystem coverage; no prompt was sent to existing user conversations.

## Mini App presentation

The session list and chat follow the compact mobile Codex layout: borderless rows, concise back/title/source header, plain assistant text, neutral user bubbles and a rounded composer. History/terminal tabs appear only for terminal-capable sources. Measured virtualization, message navigation/previews, bottom control, Markdown/code copy, Russian/English and automatic Telegram/system light/dark detection are preserved.
Both palettes use cool neutral backgrounds and blue accents. Selected sessions hide
the app branding row and show a green/red availability dot in the conversation
header; hover, keyboard focus or tap reveals localized details.

References viewed on 2026-10-17: [official mobile announcement](https://openai.com/index/work-with-codex-from-anywhere/), [official announcement image](https://us1.discourse-cdn.com/openai1/optimized/4X/d/b/5/db5751fed75990103a39c9ebe43ca180e9d04053_2_690x388.jpeg), [mobile screen montage](https://www.macg.co/intelligence-artificielle/2026/05/codex-mobile-code-et-pilote-les-mac-depuis-un-smartphone-308593), [real mobile chat screenshot](https://x.com/theo/status/2056918722062008347). Screenshots are visual references, not evidence for backend integration.
