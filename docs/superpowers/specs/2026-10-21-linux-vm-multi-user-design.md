# Agent Remote on a Linux VM for several users

## Intent

The whole of Agent Remote runs on one Linux VM: the relay, bot, Postgres and Redis, and the agents (Claude Code
and Codex) with their projects. People only have clients: the Telegram Mini App, the Mac client and the Chrome
extension. Each person opens the app under their own Telegram account and sees only the sessions they created.

## What the owner decided

- **Everything on the VM.** Users run no agent, daemon or project on their own machines.
- **One shared subscription.** Claude Code and Codex are signed in once on the VM, with the subscription (not an
  API key), and every user's sessions use it.
- **Isolation is by Telegram identity.** A session belongs to the Telegram user who created it from the app; a
  user sees and controls only their own sessions.
- **No per-user OS sandbox.** All agents run as one Linux user on shared files; an agent of one user can
  technically read another user's project files. The owner accepted this.

## Design

One daemon per Telegram user on the VM, each with its own state directory (`CLAUDE_REMOTE_HOME`) and device token
paired to that user. The relay already isolates everything by `(owner, device)` — events, commands, attachments,
snapshots, pins, rules — so a per-user daemon gets the existing, tested isolation for free.

```
VM (one Linux user; ~/.claude and ~/.codex signed in once)
├── server: relay, bot, Postgres, Redis, Caddy
├── supervisor: starts a daemon for every user who opened the app
├── daemon of user A  (CLAUDE_REMOTE_HOME=/data/users/A, device paired to Telegram A)
└── daemon of user B  (CLAUDE_REMOTE_HOME=/data/users/B, device paired to Telegram B)
```

### Verified facts (2026-10-21)

- A daemon launches Claude through `entry claude` with `CLAUDE_REMOTE_HOME` exported
  (`apps/daemon/src/sessions/launch/launcher.ts`); the session's hooks therefore reach only that daemon's socket.
- Each daemon starts its own Codex app-server at `<state>/codex/app-server.sock`; its `thread/loaded/list` holds
  only threads that daemon started or resumed. The daemon also connects to the shared
  `~/.codex/app-server-control` socket and Codex Desktop IPC (`codex-manager.ts` `start()`), which would show every
  user the threads loaded there.
- The `entry claude` wrapper runs Claude in its own PTY (`PtySessionManager`) but needs a terminal for its own
  stdio; on macOS the launcher opens Terminal.app or cmux. Session creation, native restarts and local pairing are
  gated on `process.platform === 'darwin'`.
- The relay's Docker image builds for `linux/amd64` from a clean checkout (`docker build`, 2026-10-21).

### Parts

1. **Multi-user mode in the daemon** (`REMOTE_MULTI_USER=1`): connect only to the daemon's own managed Codex
   app-server, never to `~/.codex/app-server-control` or Codex Desktop IPC; skip native Claude discovery
   (`~/.claude/sessions` scan, native restarts) so another user's processes never appear; skip macOS-only
   integrations (cmux attach, Accessibility, Claude Desktop).
2. **Linux session launch:** create Claude sessions by running `entry claude` in a detached tmux session named
   after the launch id; Codex sessions need no change. tmux gives the wrapper a terminal, survives daemon
   restarts, and lets the daemon read the screen (`tmux capture-pane`) and press Enter (`tmux send-keys`) to
   confirm Claude's model dialog, as cmux does on macOS.
3. **Projects:** a session is created in a project directory on the VM. The app's "New session" offers the
   directories of existing sessions (as now) and, in multi-user mode, the projects under a configured root
   (`REMOTE_PROJECTS_ROOT`, e.g. `/data/projects`), so a new user can start a first session.
4. **Supervisor:** a process next to the daemons that, for every user who has opened the app and has no VM
   device, pairs a new device for that user through an operator-only relay endpoint (authenticated by a secret
   shared with the relay, never reachable from the app) and starts `remote start` with that user's state
   directory; it restarts daemons that exit.
5. **Deployment:** `compose.vm.yml` with the relay stack and an `agents` service (Node, Claude Code, Codex, tmux,
   git, the supervisor) sharing a volume for `~/.claude`, `~/.codex`, `/data/users` and `/data/projects`;
   `docs/vm-deploy.md` with the one-time `claude` and `codex login` in the agents container.

## Non-goals

- Per-user OS isolation, quotas or separate subscriptions.
- Moving existing macOS personal mode; it keeps working as today.
- Sharing a session between users.

## Left to the builder

- tmux session naming, supervisor polling interval, the operator endpoint's shape.
- Whether the Mac client keeps its embedded companion for personal mode (it does; in VM mode it only connects to
  the relay as a client).
