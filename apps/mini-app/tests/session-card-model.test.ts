import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import { Language, type Session } from "@protocol"
import { createLanguageInstance } from "../src/shared/lib/i18n/index.js"
import { SessionCard } from "../src/entities/session/ui/session-card.js"
import { SESSION_CARD_IDS } from "../src/entities/session/config/test-ids.js"
import { sessionSnapshot } from "../../../tests/e2e/support/session-fixtures.js"

function render(session: Session, language: Language) {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: createLanguageInstance(language) }, createElement(SessionCard, { session, onSelect: () => {} })),
  )
}

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
