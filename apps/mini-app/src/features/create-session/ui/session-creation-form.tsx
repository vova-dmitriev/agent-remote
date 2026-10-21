import { Bot, Folder } from "lucide-react"
import { AgentProvider, CapabilityKey, type ModelChoice, type Session } from "@protocol"
import { ProviderFilterValue } from "@/entities/session"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { ChoiceDropdown } from "@/shared/ui/dropdown"
import { chipFieldClass, chipLabelClass } from "../config/chip-classes"
import { SESSION_CREATE_IDS } from "../config/test-ids"
import type { ProfileExecution } from "../model/profile-launch"
import { resolveSessionProfileStatus } from "../model/profile-status"
import type { useSessionCreation } from "../model/use-session-creation"
import { ModelEffortFields } from "./model-effort-fields"
import { ProfileSelectField } from "./profile-select-field"

interface SessionCreationFormProps {
  model: ReturnType<typeof useSessionCreation>
  disabled: boolean
  online: boolean
  profilesUnavailable: boolean
  checkingProfiles: boolean
  create: (session: Session, provider: AgentProvider, execution?: ProfileExecution, model?: ModelChoice) => void
}

export function SessionCreationForm({ model, disabled, online, profilesUnavailable, checkingProfiles, create }: SessionCreationFormProps) {
  const { t } = useTranslation()
  const launchReady = model.profileId === "" || (model.profileAvailable && !!model.execution)

  const status = resolveSessionProfileStatus(model, { online, unavailable: profilesUnavailable, checking: checkingProfiles }, t)

  return (
    <form
      className="flex flex-wrap items-center gap-[8px] pt-[8px] pb-[12px]"
      data-testid={SESSION_CREATE_IDS.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (model.selected && !disabled && launchReady)
          create(model.selected, model.provider, model.execution ?? undefined, model.modelChoice)
      }}
    >
      <ChoiceDropdown
        value={model.provider}
        onChange={model.setProvider}
        label={t("sessionProvider")}
        triggerLabel={model.provider === AgentProvider.Codex ? ProviderFilterValue.Codex : ProviderFilterValue.Claude}
        icon={Bot}
        ids={SESSION_CREATE_IDS.provider}
        className={chipFieldClass}
        labelClassName={chipLabelClass}
        options={[
          { value: AgentProvider.Claude, label: "Claude", testId: SESSION_CREATE_IDS.claude },
          { value: AgentProvider.Codex, label: "Codex", testId: SESSION_CREATE_IDS.codex },
        ]}
      />
      <ChoiceDropdown
        value={model.selected?.id ?? ""}
        onChange={model.setProjectId}
        label={t("sessionProject")}
        triggerLabel={model.selected?.cwd ?? ""}
        icon={Folder}
        ids={SESSION_CREATE_IDS.project}
        className={chipFieldClass}
        labelClassName={chipLabelClass}
        options={model.projects.map((session) => ({
          value: session.id,
          label: session.cwd ?? "",
          testId: SESSION_CREATE_IDS.projectOption,
        }))}
      />
      <ProfileSelectField
        nativeProvider={model.provider === AgentProvider.Codex ? ProviderFilterValue.Codex : ProviderFilterValue.Claude}
        profiles={model.profiles}
        profileId={model.profileId}
        profile={model.profile}
        disabled={disabled}
        onChange={model.setLaunchProfile}
      />
      <ModelEffortFields
        models={model.fieldModels}
        available={model.modelsAvailable}
        native={model.native}
        modelId={model.modelId}
        selectedModel={model.selectedModel}
        effort={model.effort}
        disabled={disabled}
        onModelChange={model.setModel}
        onEffortChange={model.setEffort}
      />
      <small className="basis-full leading-[1.4] text-muted-foreground" data-testid={SESSION_CREATE_IDS.profileStatus} role="status">
        {status}
      </small>
      <Button
        type="submit"
        data-testid={SESSION_CREATE_IDS.submit}
        disabled={disabled || !launchReady || (model.profileId !== "" && !model.execution)}
      >
        {t(disabled ? "creatingSession" : CapabilityKey.CreateSession)}
      </Button>
    </form>
  )
}
