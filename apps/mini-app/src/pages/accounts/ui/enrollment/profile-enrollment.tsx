import { CredentialEnrollmentLimits } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { PROFILE_ENROLL_IDS } from "@/pages/accounts/config/enrollment/test-ids"
import { useProfileEnrollment } from "@/pages/accounts/model/enrollment/use-profile-enrollment"
import { cn } from "@/shared/lib/utils"
import { formLabelClass } from "@/shared/ui/label"
import type { ProfileEnrollmentProps } from "./profile-enrollment.types"

export function ProfileEnrollment(props: ProfileEnrollmentProps) {
  const { t } = useTranslation()
  const model = useProfileEnrollment(props)

  return (
    <div data-testid={PROFILE_ENROLL_IDS.root} className="space-y-3 border-t border-border pt-3">
      <Button
        data-testid={PROFILE_ENROLL_IDS.toggle}
        variant="outline"
        onClick={model.toggle}
        disabled={props.disabled}
        aria-expanded={model.open}
      >
        {t("accountsAddKey")}
      </Button>
      {model.open ? (
        <form
          data-testid={PROFILE_ENROLL_IDS.form}
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void model.submit()
          }}
        >
          <p className="text-sm text-muted-foreground">{t("accountsPinHint")}</p>
          <label className={cn(formLabelClass, "space-y-1")}>
            <span>{t("accountsPinLabel")}</span>
            <Input
              data-testid={PROFILE_ENROLL_IDS.pin}
              value={model.pin}
              onChange={(event) => model.setPin(event.target.value)}
              minLength={64}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              autoComplete="off"
              spellCheck={false}
              disabled={props.disabled}
              required
            />
          </label>
          <label className={cn(formLabelClass, "space-y-1")}>
            <span>{t("accountsKeyLabel")}</span>
            <Input
              data-testid={PROFILE_ENROLL_IDS.key}
              type="password"
              value={model.secret}
              onChange={(event) => model.setSecret(event.target.value)}
              maxLength={CredentialEnrollmentLimits.SecretBytes}
              autoComplete="off"
              disabled={props.disabled}
              required
            />
          </label>
          <Button
            data-testid={PROFILE_ENROLL_IDS.submit}
            type="submit"
            disabled={props.disabled || !model.secret || !/^[a-f0-9]{64}$/.test(model.pin)}
          >
            {t("accountsEnroll")}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
