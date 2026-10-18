import { AgentProvider, ProfileAction, ProfileAuthMode, ProfileRequestKind, ProfileStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { PROFILE_MANAGE_IDS } from "@/pages/accounts/config/management/test-ids"
import { useProfileActions } from "@/pages/accounts/model/management/use-profile-actions"
import type { ProfileActionsProps } from "./profile-actions.types"

export function ProfileActions(props: ProfileActionsProps) {
  const { profile, operation, disabled, preferred, run } = props
  const { t } = useTranslation()
  const model = useProfileActions(props)
  const removing = profile.status === ProfileStatus.Removing
  const unavailable = disabled || removing

  return (
    <div data-testid={PROFILE_MANAGE_IDS.actions} className="space-y-3">
      {model.editing ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void model.save()
          }}
        >
          <Input
            data-testid={PROFILE_MANAGE_IDS.renameInput}
            aria-label={t("accountsName")}
            value={model.label}
            maxLength={128}
            onChange={(event) => model.setLabel(event.target.value)}
            disabled={disabled}
            required
          />
          <Button data-testid={PROFILE_MANAGE_IDS.save} type="submit" disabled={disabled || !model.label.trim()}>
            {t("accountsSave")}
          </Button>
          <Button data-testid={PROFILE_MANAGE_IDS.cancel} variant="ghost" type="button" onClick={model.cancel}>
            {t("accountsCancel")}
          </Button>
        </form>
      ) : (
        <Button data-testid={PROFILE_MANAGE_IDS.rename} variant="outline" onClick={model.rename} disabled={unavailable}>
          {t("accountsRename")}
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid={PROFILE_MANAGE_IDS.check}
          variant="outline"
          disabled={unavailable || profile.status === ProfileStatus.Disabled || profile.provider !== AgentProvider.Codex}
          onClick={() => void model.authenticate(ProfileAction.Check)}
        >
          {t("accountsCheck")}
        </Button>
        {profile.authMode === ProfileAuthMode.Subscription ? (
          <Button
            data-testid={PROFILE_MANAGE_IDS.signIn}
            variant="outline"
            disabled={unavailable || profile.status === ProfileStatus.Disabled || profile.provider !== AgentProvider.Codex}
            onClick={() => void model.authenticate(ProfileAction.SignIn)}
          >
            {t("accountsSignIn")}
          </Button>
        ) : null}
        <Button
          data-testid={PROFILE_MANAGE_IDS.enabled}
          variant="outline"
          disabled={unavailable}
          onClick={() => void model.mutation(profile.status === ProfileStatus.Disabled ? ProfileAction.Enable : ProfileAction.Disable)}
        >
          {t(profile.status === ProfileStatus.Disabled ? "accountsEnable" : "accountsDisable")}
        </Button>
        <Button
          data-testid={PROFILE_MANAGE_IDS.setDefault}
          variant="outline"
          disabled={unavailable || preferred || profile.status !== ProfileStatus.Ready}
          onClick={() => void model.mutation(ProfileAction.SetDefault)}
        >
          {t("accountsSetDefault")}
        </Button>
        <Button
          data-testid={PROFILE_MANAGE_IDS.remove}
          variant="ghost"
          disabled={unavailable}
          onClick={() => void model.mutation(ProfileAction.Remove)}
        >
          {t("accountsRemove")}
        </Button>
        {operation ? (
          <Button
            data-testid={PROFILE_MANAGE_IDS.reconcile}
            variant="outline"
            disabled={disabled}
            onClick={() => void run({ kind: ProfileRequestKind.Reconcile, operationId: operation.id })}
          >
            {t("accountsReconcile")}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t("accountsRemoveHint")}</p>
    </div>
  )
}
