import type { AgentModel, ReasoningEffort, Session } from "@protocol"
import type { SwitchModelController } from "../model/use-switch-model"

/**
 * The session's current model and effort, and the models to offer. A model the session runs that the list does not
 * offer (a full Claude name, say) stays first, so the current one always shows.
 */
export function modelChoice(session: Session, models: readonly AgentModel[], controller: SwitchModelController) {
  const chosen = controller.chosen(session.id)
  const current = chosen?.model ?? session.model ?? ""
  const model = models.find((entry) => entry.id === current)
  const effort: ReasoningEffort | "" = chosen?.model === current ? (chosen.effort ?? "") : ""
  const ids = current !== "" && !model ? [current, ...models.map((entry) => entry.id)] : models.map((entry) => entry.id)

  return { current, model, effort, ids }
}
