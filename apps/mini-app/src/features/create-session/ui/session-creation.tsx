import { Plus } from "lucide-react"
import { useExecutionProfiles } from "@/entities/execution-profile"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_CREATE_IDS } from "../config/test-ids"
import { useSessionCreation } from "../model/use-session-creation"
import { SessionCreationForm } from "./session-creation-form"
import type { SessionCreationProps } from "./session-creation.types"

export function SessionCreation({ sessions, disabled, online, create, profileData }: SessionCreationProps) {
  const { t } = useTranslation()
  const deviceId = sessions[0]?.target.deviceId ?? ""
  const profileQuery = useExecutionProfiles(deviceId, online)
  const data = profileData ?? profileQuery.data
  const checking = (profileQuery.isFetching || profileQuery.isError) && !profileData
  const model = useSessionCreation(sessions, data, online, checking)

  if (!model.selected) return null

  return (
    <div className="session-create" data-testid={SESSION_CREATE_IDS.root}>
      <Button variant="ghost" data-testid={SESSION_CREATE_IDS.toggle} aria-expanded={model.open} onClick={() => model.setOpen(!model.open)}>
        <Plus size={16} aria-hidden="true" /> {t("newSession")}
      </Button>
      {model.open ? (
        <SessionCreationForm
          model={model}
          disabled={disabled}
          online={online}
          profilesUnavailable={!data || !data.available || profileQuery.isError}
          checkingProfiles={profileQuery.isFetching && !profileData}
          create={create}
        />
      ) : null}
    </div>
  )
}
