import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import {
  BindingState,
  ConnectionStatus,
  DeviceStatus,
  ErrorCode,
  IntegrationState,
  Language,
  SessionStatus,
  StatusConfidence,
  type Session,
} from "@protocol"
import { createLanguageInstance } from "../src/shared/lib/i18n/index.js"
import { SessionCard } from "../src/entities/session/ui/session-card.js"
import { SESSION_CARD_IDS } from "../src/entities/session/config/test-ids.js"
import { initialState } from "../src/entities/session/model/session-state.js"
import { sessionObserved } from "../src/pages/session/lib/session-availability.js"
import { sessionSnapshot } from "../../../tests/e2e/support/fixtures/session-fixtures.js"

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

it.each([
  [Language.En, "Session too large to mirror", "Session unavailable"],
  [Language.Ru, "Сессия слишком большая для показа", "Сессия недоступна"],
] as const)("names an oversize Codex thread instead of the generic unavailable label in %s", (language, label, generic) => {
  const session = {
    ...sessionSnapshot("device").sessions[0]!,
    binding: BindingState.Unverified,
    integrationState: IntegrationState.Disconnected,
    errorCode: ErrorCode.CODEX_FRAME_TOO_LARGE,
  }

  const html = render(session, language)

  expect(html).toContain(label)
  expect(html).not.toContain(generic)
})

function liveTerminalObservation(): Session {
  const session = sessionSnapshot("device").sessions[0]!

  return {
    ...session,
    status: SessionStatus.Unknown,
    binding: BindingState.Unverified,
    integrationState: IntegrationState.NeedsRestart,
    statusConfidence: StatusConfidence.Observed,
    capabilities: { ...session.capabilities, prompt: false, interrupt: false },
  }
}

function appState(connection: ConnectionStatus = ConnectionStatus.Online, deviceStatus: DeviceStatus = DeviceStatus.Online) {
  return { ...initialState(), connection, snapshot: { ...sessionSnapshot("device"), deviceStatus } }
}

it("keeps a restored session without a live hook unavailable until it is observed", () => {
  const restored = { ...liveTerminalObservation(), statusConfidence: StatusConfidence.Inferred }

  expect(render(restored, Language.En)).toContain("Session unavailable")
  expect(sessionObserved(appState(), restored)).toBe(false)

  expect(render({ ...restored, statusConfidence: StatusConfidence.Observed }, Language.En)).toContain(
    "Observation only · restart for input",
  )
})

it.each([
  [Language.En, "Observation only · restart for input", "Session unavailable"],
  [Language.Ru, "Только наблюдение · для ввода нужен перезапуск", "Сессия недоступна"],
] as const)("labels a live terminal session that needs a restart for input as observed in %s", (language, label, generic) => {
  const html = render(liveTerminalObservation(), language)

  expect(html).toContain(label)
  expect(html).not.toContain(generic)
})

it("keeps a needs-restart session without live observation unavailable", () => {
  const session = liveTerminalObservation()

  for (const capabilities of [
    { ...session.capabilities, observe: false },
    { ...session.capabilities, history: false },
  ]) {
    expect(render({ ...session, capabilities }, Language.En)).toContain("Session unavailable")
  }

  expect(render({ ...session, status: SessionStatus.Ended }, Language.En)).not.toContain("Observation only")
})

it("observes a needs-restart session only while the app and device are online", () => {
  const session = liveTerminalObservation()

  const state = appState

  expect(sessionObserved(state(ConnectionStatus.Online, DeviceStatus.Online), session)).toBe(true)
  expect(sessionObserved(state(ConnectionStatus.Offline, DeviceStatus.Online), session)).toBe(false)
  expect(sessionObserved(state(ConnectionStatus.Online, DeviceStatus.Offline), session)).toBe(false)

  expect(
    sessionObserved(state(ConnectionStatus.Online, DeviceStatus.Online), { ...session, integrationState: IntegrationState.Disconnected }),
  ).toBe(false)
})
