import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import { IntegrationState, Language, SessionStatus, StatusConfidence, type Session } from "@protocol"
import { createLanguageInstance } from "../src/shared/lib/i18n/index.js"
import { SessionCard } from "../src/entities/session/ui/session-card.js"
import { SessionStatusTone, ProviderFilterValue } from "../src/entities/session/config/session-values.js"
import { sessionStatusTone } from "../src/entities/session/lib/status-tone.js"
import { sessionsAwaitingInput, sortByRecency } from "../src/entities/session/lib/selectors.js"
import { filterSessions, matchParts } from "../src/widgets/session-sidebar/lib/sidebar-search.js"
import { groupByRecency } from "../src/widgets/session-sidebar/lib/sidebar-groups.js"
import { relativeTime } from "../src/widgets/session-sidebar/lib/sidebar-format.js"
import { SidebarGroup } from "../src/widgets/session-sidebar/config/values.js"
import { sessionSnapshot } from "../../../tests/e2e/support/fixtures/session-fixtures.js"

const NOW = new Date(2026, 9, 19, 15, 0).getTime()
const MINUTE = 60_000
const [terminal, chat, codexCli, codexDesktop] = sessionSnapshot("device").sessions as [Session, Session, Session, Session]

function at(session: Session, minutesAgo: number, extra: Partial<Session> = {}): Session {
  return { ...session, ...extra, lastEventAt: NOW - minutesAgo * MINUTE, lastMessageAt: NOW - minutesAgo * MINUTE }
}

it("maps every status to one tone: running, waiting, idle and unavailable", () => {
  expect(sessionStatusTone({ ...terminal, status: SessionStatus.Running })).toBe(SessionStatusTone.Running)
  expect(sessionStatusTone({ ...terminal, status: SessionStatus.WaitingPermission })).toBe(SessionStatusTone.Attention)
  expect(sessionStatusTone({ ...terminal, status: SessionStatus.WaitingInput })).toBe(SessionStatusTone.Attention)
  expect(sessionStatusTone({ ...terminal, status: SessionStatus.Idle })).toBe(SessionStatusTone.Idle)
  expect(sessionStatusTone({ ...terminal, status: SessionStatus.Ended })).toBe(SessionStatusTone.Unavailable)
  expect(sessionStatusTone({ ...terminal, integrationState: IntegrationState.Disconnected })).toBe(SessionStatusTone.Unavailable)
  expect(sessionStatusTone({ ...terminal, status: SessionStatus.Unknown })).toBe(SessionStatusTone.Unavailable)

  const observeOnly = {
    ...terminal,
    status: SessionStatus.Running,
    integrationState: IntegrationState.NeedsRestart,
    statusConfidence: StatusConfidence.Observed,
  }

  expect(sessionStatusTone(observeOnly)).toBe(SessionStatusTone.Running)
})

it("marks a session with a pending permission or question for attention even when its status lags", () => {
  const snapshot = sessionSnapshot("device")
  const awaiting = sessionsAwaitingInput(snapshot.sessions, snapshot.permissions, snapshot.userInputs)
  const [withPermission] = snapshot.sessions as [Session]

  expect(withPermission.status).toBe(SessionStatus.Idle)
  expect(awaiting.has(withPermission.id)).toBe(true)
  expect(sessionStatusTone(withPermission, awaiting.has(withPermission.id))).toBe(SessionStatusTone.Attention)
  expect(sessionStatusTone({ ...withPermission, status: SessionStatus.Running }, true)).toBe(SessionStatusTone.Attention)
  expect(sessionStatusTone({ ...withPermission, status: SessionStatus.Ended }, true)).toBe(SessionStatusTone.Unavailable)
  expect(awaiting.has(chat.id)).toBe(false)

  const staleGeneration = { ...snapshot, permissions: snapshot.permissions.map((item) => ({ ...item, generation: "old" })) }

  expect(sessionsAwaitingInput(staleGeneration.sessions, staleGeneration.permissions, staleGeneration.userInputs).size).toBe(0)
})

it("renders the shared tone on the session card", () => {
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createLanguageInstance(Language.En) },
      createElement(SessionCard, { session: { ...terminal, status: SessionStatus.Idle }, awaitingInput: true, onSelect: () => {} }),
    ),
  )

  expect(html).toContain(`data-tone="${SessionStatusTone.Attention}"`)
})

it("searches title, project, model and provider name within the provider chip", () => {
  const sessions = [{ ...terminal, cwd: "/Users/fixture/projects/lumen-web" }, chat, codexCli, codexDesktop]

  expect(filterSessions(sessions, "codex", ProviderFilterValue.All).map((session) => session.id)).toEqual([codexCli.id, codexDesktop.id])
  expect(filterSessions(sessions, "LUMEN", ProviderFilterValue.All)).toHaveLength(1)
  expect(filterSessions(sessions, "sonnet", ProviderFilterValue.All).map((session) => session.id)).toEqual([terminal.id])
  expect(filterSessions(sessions, "sprint", ProviderFilterValue.Codex)).toEqual([])
  expect(filterSessions(sessions, " ", ProviderFilterValue.Claude)).toHaveLength(2)
})

it("splits every case-insensitive match for highlighting", () => {
  expect(matchParts("Codex codex", "CODEX")).toEqual([
    { text: "Codex", match: true },
    { text: " ", match: false },
    { text: "codex", match: true },
  ])

  expect(matchParts("plain", "")).toEqual([{ text: "plain", match: false }])
})

it("groups newest first into today, yesterday and earlier", () => {
  const sections = groupByRecency([at(chat, 60 * 40), at(terminal, 5), at(codexCli, 60 * 20)], NOW)

  expect(sections.map((section) => section.group)).toEqual([SidebarGroup.Today, SidebarGroup.Yesterday, SidebarGroup.Earlier])
  expect(sections.map((section) => section.sessions[0]!.id)).toEqual([terminal.id, codexCli.id, chat.id])
})

it("formats compact relative times and falls back to a date after a week", () => {
  expect(relativeTime(NOW - 30_000, NOW, Language.En)).toBeNull()
  expect(relativeTime(NOW - 4 * MINUTE, NOW, Language.En)).toBe("4m")
  expect(relativeTime(NOW - 180 * MINUTE, NOW, Language.En)).toBe("3h")
  expect(relativeTime(NOW - 2 * 1_440 * MINUTE, NOW, Language.En)).toBe("2d")
  expect(relativeTime(NOW - 10 * 1_440 * MINUTE, NOW, Language.En)).toBe("Oct 9")
})

it("orders every list by the last message and never by status events", () => {
  const statusOnly = { ...chat, lastMessageAt: undefined, lastEventAt: NOW }
  const older = at(terminal, 30)
  const newer = at(codexCli, 5)

  expect(sortByRecency([statusOnly, older, newer]).map((session) => session.id)).toEqual([codexCli.id, terminal.id, chat.id])
  expect(groupByRecency([statusOnly], NOW).map((section) => section.group)).toEqual([SidebarGroup.Earlier])
})
