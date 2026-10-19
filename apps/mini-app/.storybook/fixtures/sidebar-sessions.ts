import { IntegrationState, SessionStatus, type Session } from "@protocol"
import { terminalSession, chatSession, codexCliSession, codexDesktopSession } from "./session"
import { desktopCodeSession } from "./page-states"

/** Fixed local "now" (19 Oct 2026, 15:00 local time) so grouping and relative labels are deterministic. */
export const SIDEBAR_NOW = new Date(2026, 9, 19, 15, 0).getTime()

const MINUTE_MS = 60_000
const DAY_MINUTES = 1_440
const SONNET = "claude-sonnet-4-6"
const OPUS = "claude-opus-4-6"
const CODEX_CLI = "gpt-synthetic-cli"
const CODEX_DESKTOP = "gpt-synthetic-desktop"
const { Idle, Running, WaitingPermission, WaitingInput, Ended } = SessionStatus

type Row = [
  title: string,
  project: string,
  base: Session,
  model: string | undefined,
  status: SessionStatus,
  minutesAgo: number,
  offline?: true,
]

/** Synthetic titles and projects only — no real chats, names or paths. */
const rows: Row[] = [
  ["Fix flaky checkout e2e test", "lumen-web", terminalSession, SONNET, Running, 2],
  ["Review Codex thread import mapping", "codex-bridge", codexDesktopSession, CODEX_DESKTOP, WaitingPermission, 9],
  ["Add retry budget to upload worker", "orbit-api", codexCliSession, CODEX_CLI, Running, 17],
  ["Draft release notes for 2.4", "ferry-docs", chatSession, undefined, Idle, 41],
  ["Migrate settings form to zod 4", "lumen-web", desktopCodeSession, OPUS, WaitingInput, 75],
  ["Profile slow search query", "orbit-api", terminalSession, SONNET, Idle, 130],
  ["Audit Codex CLI sandbox flags", "atlas-cli", codexCliSession, CODEX_CLI, Idle, 190],
  ["Split billing module into services", "orbit-api", terminalSession, OPUS, Ended, 260],
  ["Tidy storybook fixtures", "lumen-web", codexDesktopSession, CODEX_DESKTOP, Idle, 410],
  ["Explain the cache invalidation bug", "quarry-ml", terminalSession, SONNET, Idle, 540, true],
  ["Rename feature flags", "atlas-cli", desktopCodeSession, SONNET, Idle, 960],
  ["Port pagination to cursor API", "orbit-api", codexCliSession, CODEX_CLI, Idle, 1_080],
  ["Summarise onboarding feedback", "ferry-docs", chatSession, undefined, Idle, 1_210],
  ["Benchmark embedding batch sizes", "quarry-ml", codexDesktopSession, CODEX_DESKTOP, Ended, 1_400],
  ["Harden webhook signature check", "orbit-api", terminalSession, OPUS, Idle, 1_650],
  ["Write migration for audit log", "orbit-api", desktopCodeSession, SONNET, Idle, 1_900, true],
  ["Fix dark mode contrast in charts", "lumen-web", codexCliSession, CODEX_CLI, Idle, 2_200],
  ["Prototype Codex desktop deep links", "codex-bridge", codexDesktopSession, CODEX_DESKTOP, Idle, 3_100],
  ["Upgrade lint toolchain", "atlas-cli", terminalSession, SONNET, Ended, 4_300],
  ["Outline plugin architecture", "ferry-docs", chatSession, undefined, Idle, 5_800],
  ["Reduce Docker image size", "orbit-api", codexCliSession, CODEX_CLI, Idle, 7_400],
  ["Trace memory leak in worker pool", "quarry-ml", terminalSession, OPUS, Idle, 9_900],
  ["Add CSV export to reports", "lumen-web", desktopCodeSession, SONNET, Idle, 12_500],
  ["Evaluate retrieval prompts", "quarry-ml", codexDesktopSession, CODEX_DESKTOP, Idle, 16_000, true],
  ["Set up preview deployments", "atlas-cli", codexCliSession, CODEX_CLI, Ended, 21_000],
]

function build(rowsToBuild: Row[], shiftMinutes = 0, suffix = ""): Session[] {
  return rowsToBuild.map(([title, project, base, model, status, minutesAgo, offline], index) => {
    const at = SIDEBAR_NOW - (minutesAgo + shiftMinutes) * MINUTE_MS

    return {
      ...base,
      id: `sidebar-${index}${suffix}`,
      title,
      cwd: "/Users/fixture/projects/" + project,
      model,
      status,
      lastEventAt: at,
      lastMessageAt: at,
      ...(offline ? { integrationState: IntegrationState.Disconnected } : {}),
    }
  })
}

export const sidebarSessions: Session[] = build(rows)

/** Three generations of the same synthetic rows spread over several weeks, for scrolling. */
export const manySidebarSessions: Session[] = [
  ...sidebarSessions,
  ...build(rows, 30 * DAY_MINUTES, "-older"),
  ...build(rows, 60 * DAY_MINUTES, "-oldest"),
]
