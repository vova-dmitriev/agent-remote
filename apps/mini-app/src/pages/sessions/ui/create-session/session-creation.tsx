import { Bot, Folder, Plus } from "lucide-react"
import { AgentProvider, CapabilityKey } from "@protocol"
import { ProviderFilterValue } from "@/pages/sessions/config/values"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { ChoiceDropdown } from "@/shared/ui/dropdown"
import { SESSION_CREATE_IDS } from "@/pages/sessions/config/test-ids"
import { useSessionCreation } from "@/pages/sessions/model/use-session-creation"
import type { SessionCreationProps } from "./session-creation.types"

export function SessionCreation({ sessions, disabled, create }: SessionCreationProps) {
  const { t } = useTranslation()
  const model = useSessionCreation(sessions)

  if (!model.selected) return null

  return (
    <div className="session-create" data-testid={SESSION_CREATE_IDS.root}>
      <Button variant="ghost" data-testid={SESSION_CREATE_IDS.toggle} aria-expanded={model.open} onClick={() => model.setOpen(!model.open)}>
        <Plus size={16} aria-hidden="true" /> {t("newSession")}
      </Button>
      {model.open ? (
        <form
          data-testid={SESSION_CREATE_IDS.form}
          onSubmit={(event) => {
            event.preventDefault()
            if (model.selected && !disabled) create(model.selected, model.provider)
          }}
        >
          <ChoiceDropdown
            value={model.provider}
            onChange={model.setProvider}
            label={t("sessionProvider")}
            triggerLabel={model.provider === AgentProvider.Codex ? ProviderFilterValue.Codex : ProviderFilterValue.Claude}
            icon={Bot}
            ids={SESSION_CREATE_IDS.provider}
            options={[
              { value: AgentProvider.Claude, label: "Claude", testId: SESSION_CREATE_IDS.claude },
              { value: AgentProvider.Codex, label: "Codex", testId: SESSION_CREATE_IDS.codex },
            ]}
          />
          <ChoiceDropdown
            value={model.selected.id}
            onChange={model.setProjectId}
            label={t("sessionProject")}
            triggerLabel={model.selected.cwd ?? ""}
            icon={Folder}
            ids={SESSION_CREATE_IDS.project}
            options={model.projects.map((session) => ({
              value: session.id,
              label: session.cwd ?? "",
              testId: SESSION_CREATE_IDS.projectOption,
            }))}
          />
          <small>{t(model.provider === AgentProvider.Codex ? "newCodexSessionHint" : "newClaudeSessionHint")}</small>
          <Button type="submit" data-testid={SESSION_CREATE_IDS.submit} disabled={disabled}>
            {t(disabled ? "creatingSession" : CapabilityKey.CreateSession)}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
