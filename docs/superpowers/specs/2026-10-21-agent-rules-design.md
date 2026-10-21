# Agent rules: stop risky commands and ask the owner

## Intent

The owner runs Claude Code and Codex sessions that execute commands on their Mac, often unattended and often in
modes that never ask (`bypass permissions on`, Codex `approval_policy = "never"`). Some commands are too risky to
let through silently, first of all suspicious database queries (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without
`WHERE`, against a production database). The owner wants such a command to stop and ask them, from the desktop or
Telegram app, and wants to see at a glance which rules are in force and add or switch them easily, per project and
per session.

## What the owner decided

- **Stop and ask, not silently block.** A matched command does not run; the owner gets a request marked ❗ ("this is
  important") naming the agent, the session, the exact command and the rule that matched.
- **Three answers:** Allow once, Allow always, Deny. _Allow always_ remembers only that exact command; any other
  command the rule matches still asks.
- **No answer means deny** after a timeout.
- **Both agents:** Claude Code and Codex, the same rules and the same experience.
- **Scopes:** a rule is switched on for a project or for one session.
- **A Rules page in settings** (next to Usage), with a tab per project and one for the current session; the session
  header shows a 🛡 badge with the number of rules in force that opens it (mockup option B, chosen in the
  brainstorm).
- **Ready rules switched on with a toggle,** plus "Own rule…" described in words.
- **Own rules are compiled once:** the owner's words become explicit command patterns when the rule is created; the
  owner sees and confirms (or edits) the patterns; checking a command later is instant and deterministic. No model
  call per command.
- **Session permission mode:** in a session running with bypass permissions, _project_ rules are silent; rules the
  owner added on that _session's_ tab always apply. The session tab says so plainly: "The session runs with bypass
  permissions: project rules do not apply, rules of this session do."

## Goals

- A risky command never runs without the owner's answer while a rule that covers it is in force.
- The owner can see, for any project or session, every rule in force and where it comes from.
- Adding a rule takes a toggle or one sentence.

## Non-goals

- Policing file edits, web fetches or MCP tools other than shell-like command tools (a later rule kind can add them).
- A per-command model judgement.
- Rules shared between owners or devices.
- Changing an agent's own permission settings (`~/.claude/settings.json` permissions, Codex `approval_policy`).

## Anti-goals

- A rule that looks on but lets the command through (the hook timing out, a crashed check, a bypass session the
  owner was not told about).
- Prompting so often that the owner stops reading: each stop must name the command and the rule.

## Verified facts (2026-10-21, Claude Code 2.1.305, codex-cli 0.149.0)

- **Claude PreToolUse input** carries `permission_mode` (`bypassPermissions` in a bypass session), `tool_name`,
  `tool_input`, `session_id`, `cwd`, `transcript_path`. Probe: an isolated `claude -p --setting-sources project
--settings <file> --permission-mode bypassPermissions` with a PreToolUse hook.
- **A PreToolUse `deny` blocks the command even in bypass mode** (same probe: the `touch` never ran, Claude reported
  the hook's reason).
- **A hook that exceeds its timeout lets the command run** (probe: hook `timeout: 3`, script sleeping 15 s; the
  command ran). Agent Remote installs its PreToolUse hook with `timeout: 5`
  (`apps/daemon/src/code/hooks/install-hooks.ts`), so waiting for the owner needs a hook timeout longer than the
  answer timeout, and the hook itself must answer `deny` when the owner's time runs out.
- **Codex has hooks** (`codex features list`: `hooks stable true`; `hooks.json` or `config.toml`), with
  `PreToolUse` input including `permission_mode`, `tool_name`, `tool_input`; its PreToolUse output supports
  `permissionDecision: "deny"` with a required non-empty reason, and rejects `ask` and `allow`. Not yet probed:
  Codex's behaviour on hook timeout, and whether Codex Desktop threads run the same hooks.
- The owner's Codex config is `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`.

## How it works

- **Rule:** an id, a name, a kind (ready or own), the original sentence for own rules, and a list of command
  patterns (regular expressions over the command text of shell tools: Claude `Bash`, Codex's shell/exec tool),
  plus its scope: a project or a session.
- **Ready rules (builder's starting set, owner may revise):** Suspicious database queries; `rm -rf` outside the
  project; `git push --force`; Deploys and migrations; Changes to `.env` and secrets.
- **Check:** every PreToolUse of a shell tool goes to the daemon (as hooks do today). The daemon finds the session,
  its project and its permission mode, collects the rules in force (session rules always; project rules unless the
  mode is bypass), and matches the command. No match, or a command on the Allow-always list of the rule's scope:
  answer at once with no decision (the agent proceeds as usual).
- **Stop:** on a match the hook waits. The daemon publishes a rule request (like today's permission request) to the
  app and Telegram, marked ❗. Allow once → the hook returns no decision; Allow always → the command is stored on
  the rule's scope list, then as Allow once; Deny or timeout → `permissionDecision: "deny"` with a reason naming the
  rule ("Agent Remote rule «Suspicious database queries»: denied by the owner" / "…: no answer in 10 minutes").
- **Timeout:** 10 minutes without an answer means deny. The PreToolUse hook timeout is raised above it (e.g. 660 s)
  by the hook installer for both agents.
- **Own rule from words:** the daemon runs Claude Code locally (`claude -p`, the owner's own subscription, no
  message text from sessions) to turn the sentence into patterns and a short name, then shows them for the owner
  to confirm or edit before the rule is saved.
- **Rules page:** Settings → Rules. Tabs: each project that has sessions on the device, and the current session.
  Each tab lists rules in force with their source, toggles for ready rules, "Own rule…", and the Allow-always list
  with Remove. The session tab shows the bypass notice when it applies.
- **Storage:** rules and allow lists live on the Mac (daemon state, like pins), owned by the device owner; the
  relay carries only what the app shows. Every read and change is checked against the device owner.

## Calls the builder made (owner to check)

1. A project is the git repository containing the session's working directory (the directory itself when it is
   not in a repository).
2. _Allow always_ is stored on the scope of the rule that matched: the project's list for a project rule, the
   session's for a session rule.
3. The answer timeout is 10 minutes.
4. The ready-rule list above.
5. The ❗ request in Telegram carries the three answer buttons directly (as in the mockup); in the app it is a card
   in the session like today's permission card.

## Owner's answers to the open questions

- **Codex with `approval_policy = "never"` and full access counts as bypass** ("Full access"): project rules are
  silent there, session rules apply.
- **When Agent Remote is not running on the Mac, commands run unchecked.** The hook answers with no decision when
  it cannot reach a daemon, as today.

## Next, as its own spec

Switching a session's access mode from the app (like Codex's "Ask for approval / Approve for me / Full access"
chip), for Claude Code and Codex. Rules read the mode; the switcher changes it.

## Left to the builder

- Pattern syntax details and the prompt that compiles a sentence into patterns.
- Wire vocabulary, frames and storage schema, following the repository's rules (`as const` vocabulary in protocol
  `*values.ts`, ownership checks on every path, Drizzle-only server access, frontend rules).
- Probing Codex's hook timeout behaviour and Codex Desktop hook coverage before relying on them.
- Two daemons can run on one Mac (CLI daemon and desktop companion) and `remote hook` delivers to both, taking the
  first non-empty answer (`apps/daemon/src/code/hooks/hook-delivery.ts`). Exactly one of them may ask the owner for
  a given command, and a deny from either must win over the other's empty answer.
