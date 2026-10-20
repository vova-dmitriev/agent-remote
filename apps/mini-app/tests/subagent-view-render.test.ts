import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import { ErrorCode, Language, ToolActivityPhase } from "@protocol"
import { AgentName } from "@/entities/session"
import { createLanguageInstance } from "../src/shared/lib/i18n/index.js"
import { MessageBubble } from "../src/pages/session/ui/session-feed/message-bubble.js"
import { SubagentPanel } from "../src/pages/session/ui/subagents/subagent-panel.js"
import { SubagentView } from "../src/pages/session/ui/subagent-view/subagent-view.js"
import { SubagentHistoryStatus } from "../src/pages/session/config/subagent.js"
import { SESSION_FEED_IDS, SUBAGENT_IDS, SUBAGENT_VIEW_IDS, TOOL_ACTIVITY_IDS } from "../src/pages/session/config/test-ids.js"
import { runningSubagentId, subagentMessages, subagentSession } from "../.storybook/fixtures/subagent.js"

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: createLanguageInstance(Language.En) }, element))

it("renders a tool call as a compact activity line with its input summary, not as a message", () => {
  const html = render(
    createElement(MessageBubble, { message: subagentMessages.find((message) => message.id === "test")!, agent: AgentName.Claude }),
  )

  expect(html).toContain(`data-testid="${TOOL_ACTIVITY_IDS.root}"`)
  expect(html).toContain(`data-tool-phase="${ToolActivityPhase.Failed}"`)
  expect(html).toContain(`data-tool-kind="command"`)
  expect(html).toContain("npm test -- parser")
  expect(html).toContain('aria-label="Failed"')
  expect(html).not.toContain(`data-testid="${SESSION_FEED_IDS.message}"`)
})

it("keeps plain messages in the message renderer", () => {
  const html = render(createElement(MessageBubble, { message: subagentMessages[0]!, agent: AgentName.Claude }))

  expect(html).toContain(`data-testid="${SESSION_FEED_IDS.message}"`)
  expect(html).not.toContain(`data-testid="${TOOL_ACTIVITY_IDS.root}"`)
})

it("offers subagent rows as buttons only with an open handler", () => {
  const agents = subagentSession.subagents!
  const clickable = render(createElement(SubagentPanel, { agents, online: true, onOpen: () => {} }))
  const plain = render(createElement(SubagentPanel, { agents, online: true }))

  expect(clickable.match(new RegExp(`data-testid="${SUBAGENT_IDS.open}"`, "g"))).toHaveLength(agents.length)
  expect(clickable).toContain('title="Open subagent Reviewer"')
  expect(plain).not.toContain(`data-testid="${SUBAGENT_IDS.open}"`)
  expect(plain).toContain(`data-testid="${SUBAGENT_IDS.row}"`)
})

const view = (overrides: Partial<Parameters<typeof SubagentView>[0]> = {}) =>
  render(
    createElement(SubagentView, {
      session: subagentSession,
      agentId: runningSubagentId,
      available: true,
      messages: [],
      status: SubagentHistoryStatus.Ready,
      error: "",
      onBack: () => {},
      onRetry: () => {},
      ...overrides,
    }),
  )

it("shows the subagent with its own labelled status, and the offline notice only when the session is not observed", () => {
  const offline = view({ available: false })
  const online = view()

  expect(online).toContain(`data-testid="${SUBAGENT_VIEW_IDS.title}">Reviewer<`)
  expect(online).toContain(`data-testid="${SUBAGENT_VIEW_IDS.status}">Subagent: Running<`)
  expect(online).not.toContain(`data-testid="${SUBAGENT_VIEW_IDS.offline}"`)
  expect(offline).toContain(`data-testid="${SUBAGENT_VIEW_IDS.offline}">Session unavailable<`)
})

it("says the transcript is unavailable instead of an empty feed", () => {
  const html = view({ status: SubagentHistoryStatus.Unavailable, error: ErrorCode.TRANSCRIPT_UNAVAILABLE })

  expect(html).toContain(`data-testid="${SUBAGENT_VIEW_IDS.unavailable}"`)
  expect(html).toContain("Transcript unavailable")
  expect(html).toContain(`data-testid="${SUBAGENT_VIEW_IDS.retry}"`)
  expect(html).not.toContain(`data-testid="${SESSION_FEED_IDS.frame}"`)
})

it("shows a loading feed first and an error notice when the first read fails", () => {
  expect(view({ status: SubagentHistoryStatus.Loading })).toContain(`data-testid="${SESSION_FEED_IDS.loading}"`)

  expect(view({ status: SubagentHistoryStatus.Failed, error: ErrorCode.SERVICE_UNAVAILABLE })).toContain(
    `data-testid="${SUBAGENT_VIEW_IDS.error}"`,
  )
})
