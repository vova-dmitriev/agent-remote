import { PermissionDecision } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { PERMISSION_IDS } from "@/pages/session/config/test-ids"
import { useCountdown } from "@/pages/session/model/use-countdown"
import type { PermissionCardProps } from "./types"

export function PermissionCard({ permission, disabled, decide }: PermissionCardProps) {
  const remaining = useCountdown(permission.expiresAt)
  const { t } = useTranslation()

  return (
    <section className="permission" data-testid={PERMISSION_IDS.root} data-request-id={permission.requestId}>
      <div className="permission-heading">
        <h2 data-testid={PERMISSION_IDS.title}>{t("permissionTitle", { tool: permission.toolName })}</h2>
        <span data-testid={PERMISSION_IDS.remaining}>{t("seconds", { count: remaining })}</span>
      </div>
      <pre data-testid={PERMISSION_IDS.input}>{JSON.stringify(permission.input, null, 2)}</pre>
      <div className="permission-actions">
        <Button
          variant="outline"
          data-testid={PERMISSION_IDS.deny}
          disabled={disabled || !remaining}
          onClick={() => decide(PermissionDecision.Deny)}
        >
          {t(PermissionDecision.Deny)}
        </Button>
        <Button data-testid={PERMISSION_IDS.allow} disabled={disabled || !remaining} onClick={() => decide(PermissionDecision.Allow)}>
          {t("allowOnce")}
        </Button>
      </div>
    </section>
  )
}
