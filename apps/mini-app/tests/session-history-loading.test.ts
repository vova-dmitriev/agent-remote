import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { I18nextProvider } from "react-i18next"
import { HistoryStatus, Language, MessageRole, type HistoryMessage } from "@protocol"
import { AgentName, SessionTab } from "@/entities/session"
import { createLanguageInstance } from "../src/shared/lib/i18n/index.js"
import { SessionFeed } from "../src/pages/session/ui/session-feed/session-feed.js"
import { SESSION_FEED_IDS } from "../src/pages/session/config/test-ids.js"

function render(historyStatus: HistoryStatus, tab: SessionTab = SessionTab.History, messages: HistoryMessage[] = [], available = true) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createLanguageInstance(Language.En) },
      createElement(SessionFeed, {
        sessionId: "synthetic-session",
        messages,
        agent: AgentName.Claude,
        terminal: null,
        tab,
        historyStatus,
        available,
      }),
    ),
  )
}

it("explains that empty cached history needs a session connection instead of promising new messages", () => {
  const html = render(HistoryStatus.Ready, SessionTab.History, [], false)

  expect(html).toContain("No cached messages. History will load when this session reconnects.")
  expect(html).not.toContain("Available messages from this session will appear here.")
})

it("renders a busy skeleton instead of empty history before the initial history response", () => {
  const html = render(HistoryStatus.Loading)

  expect(html).toContain(`data-testid="${SESSION_FEED_IDS.loading}"`)
  expect(html).toContain('aria-busy="true"')
  expect(html).not.toContain(`data-testid="${SESSION_FEED_IDS.empty}"`)
})

it("only renders the empty-history message after a successful empty response", () => {
  expect(render(HistoryStatus.Ready)).toContain(`data-testid="${SESSION_FEED_IDS.empty}"`)
  const failed = render(HistoryStatus.Error)

  expect(failed).not.toContain(`data-testid="${SESSION_FEED_IDS.empty}"`)
  expect(failed).not.toContain(`data-testid="${SESSION_FEED_IDS.loading}"`)
})

it("keeps terminal output available independently of history loading", () => {
  const html = render(HistoryStatus.Loading, SessionTab.Terminal)

  expect(html).toContain(`data-testid="${SESSION_FEED_IDS.terminal}"`)
  expect(html).not.toContain(`data-testid="${SESSION_FEED_IDS.loading}"`)
  expect(html).not.toContain('aria-busy="true"')
})

it("retains available messages while reloading instead of replacing them with skeletons", () => {
  const html = render(HistoryStatus.Loading, SessionTab.History, [
    { id: "cached", text: "Retained history", role: MessageRole.Assistant, occurredAt: 1 },
  ])

  expect(html).toContain(`data-testid="${SESSION_FEED_IDS.virtualList}"`)
  expect(html).not.toContain(`data-testid="${SESSION_FEED_IDS.loading}"`)
  expect(html).not.toContain(`data-testid="${SESSION_FEED_IDS.empty}"`)
  expect(html).not.toContain('aria-busy="true"')
})
