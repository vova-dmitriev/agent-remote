import { AgentProvider, ProfileAuthMode } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { PROFILE_MANAGE_IDS } from "@/pages/accounts/config/management/test-ids"
import { useProfileCreate } from "@/pages/accounts/model/management/use-profile-create"
import { PROFILE_PROVIDERS } from "@/pages/accounts/config/profile/providers"
import type { ProfileCreateFormProps } from "./profile-create-form.types"

export function ProfileCreateForm({ disabled, submit }: ProfileCreateFormProps) {
  const { t } = useTranslation()
  const model = useProfileCreate(submit)

  return (
    <form
      data-testid={PROFILE_MANAGE_IDS.create}
      className="grid gap-3 rounded-xl border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void model.create()
      }}
    >
      <h2 className="font-semibold">{t("accountsAdd")}</h2>
      <label className="mt-[20px] mb-[9px] block text-[12px] leading-[calc(1.25/0.875)]">
        <span>{t("accountsProvider")}</span>
        <select
          data-testid={PROFILE_MANAGE_IDS.provider}
          className="w-full rounded-md border border-border bg-background p-2 text-foreground"
          value={model.provider}
          disabled={disabled}
          onChange={(event) => model.setProvider(event.target.value === AgentProvider.Claude ? AgentProvider.Claude : AgentProvider.Codex)}
        >
          {PROFILE_PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      {!model.supported ? (
        <p data-testid={PROFILE_MANAGE_IDS.providerHint} className="text-sm text-muted-foreground">
          {t("accountsClaudeUnsupported")}
        </p>
      ) : null}
      <label className="mt-[20px] mb-[9px] block space-y-1 text-[12px]">
        <span>{t("accountsName")}</span>
        <Input
          data-testid={PROFILE_MANAGE_IDS.label}
          value={model.label}
          onChange={(event) => model.setLabel(event.target.value)}
          maxLength={128}
          placeholder={t("accountsNamePlaceholder")}
          disabled={disabled}
          required
        />
      </label>
      <select
        data-testid={PROFILE_MANAGE_IDS.authMode}
        className="w-full rounded-md border border-border bg-background p-2 text-foreground"
        aria-label={t("accountsAdd")}
        disabled={disabled}
        value={model.authMode}
        onChange={(event) =>
          model.setAuthMode(event.target.value === ProfileAuthMode.ApiKey ? ProfileAuthMode.ApiKey : ProfileAuthMode.Subscription)
        }
      >
        <option value={ProfileAuthMode.Subscription}>{t("accountsSubscription")}</option>
        <option value={ProfileAuthMode.ApiKey}>{t("accountsApiKey")}</option>
      </select>
      <Button data-testid={PROFILE_MANAGE_IDS.submit} type="submit" disabled={disabled || !model.supported || !model.label.trim()}>
        {t("accountsCreate")}
      </Button>
    </form>
  )
}
