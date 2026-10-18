import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import { BindingState, IntegrationState, Language, SessionStatus, type Session } from "@protocol"
import { createLanguageInstance } from "../src/shared/lib/i18n/index.js"
import { SessionCard } from "../src/entities/session/ui/session-card.js"
import { SESSION_CARD_IDS } from "../src/entities/session/config/test-ids.js"
import { sessionSnapshot } from "../../../tests/e2e/support/session-fixtures.js"

function render(session: Session, language: Language) {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: createLanguageInstance(language) }, createElement(SessionCard, { session, onSelect: () => {} })),
  )
}

it.each([Language.En, Language.Ru])("does not advertise a disconnected idle session as ready in %s", (language) => {
  const session = {
    ...sessionSnapshot("device").sessions[0]!,
    status: SessionStatus.Idle,
    binding: BindingState.Unverified,
    integrationState: IntegrationState.Disconnected,
  }

  const html = render(session, language)

  expect(html).toContain(language === Language.En ? "Session unavailable" : "Сессия недоступна")
  expect(html).not.toContain(language === Language.En ? "Ready for a message" : "Готов к сообщению")
})

it("labels a connected idle session without prompt capability as observation only", () => {
  const session = sessionSnapshot("device").sessions[0]!
  const html = render({ ...session, status: SessionStatus.Idle, capabilities: { ...session.capabilities, prompt: false } }, Language.En)

  expect(html).toContain("Observation only")
  expect(html).not.toContain("Ready for a message")
})

it("renders each row's actual model beside its source while preserving the title", () => {
  const session = { ...sessionSnapshot("device").sessions[0]!, model: "claude-sonnet-4-6" }
  const html = render(session, Language.En)

  expect(html).toContain(`data-testid="${SESSION_CARD_IDS.model}"`)
  expect(html).toContain("claude-sonnet-4-6")
  expect(html).toContain("Synthetic sprint fixes")
  expect(html).toContain('aria-label="Model"')
})

it.each([
  [Language.En, "Model unknown"],
  [Language.Ru, "Модель неизвестна"],
] as const)("renders an explicit translated fallback for every source without model metadata in %s", (language, unknown) => {
  for (const session of sessionSnapshot("device").sessions) {
    const html = render({ ...session, model: undefined }, language)

    expect(html).toContain(`data-testid="${SESSION_CARD_IDS.model}"`)
    expect(html).toContain(unknown)
  }
})
