import type { PendingUserInput, UserInputQuestion } from "@protocol"

export const choiceQuestion: UserInputQuestion = {
  id: "scope",
  header: "Scope",
  question: "Which **workspace** should this example use?",
  isOther: true,
  isSecret: false,
  options: [
    { label: "Current workspace", description: "Continue in the open synthetic project." },
    { label: "New workspace", description: "Start an isolated example." },
  ],
}

export const freeformQuestion: UserInputQuestion = {
  id: "name",
  header: "Project",
  question: "What should the example project be called?",
  isOther: false,
  isSecret: false,
  options: null,
}

export const questionRequest: PendingUserInput = {
  requestId: "synthetic-question",
  sessionId: "synthetic-codex",
  generation: "synthetic-generation",
  turnId: "synthetic-turn",
  itemId: "synthetic-item",
  isBlocking: true,
  expiresAt: Date.now() + 3600000,
  questions: [choiceQuestion],
}
