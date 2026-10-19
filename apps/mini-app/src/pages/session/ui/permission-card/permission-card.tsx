import { PermissionDecision } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { PERMISSION_IDS } from "@/pages/session/config/test-ids"
import { useCountdown } from "@/pages/session/model/use-countdown"
import { requestActionClass, requestActionsClass, requestHeadingClass } from "./permission-class"
import type { PermissionCardProps } from "./types"

export function PermissionCard({ permission, disabled, decide }: PermissionCardProps) {
  const remaining = useCountdown(permission.expiresAt)
  const { t } = useTranslation()

  return (
    <section
      className="my-[12px] rounded-[12px] border border-warning bg-surface p-[18px] session:my-[6px] session:p-[10px] session:short:my-[4px] session:short:p-[6px]"
      data-testid={PERMISSION_IDS.root}
      data-request-id={permission.requestId}
    >
      <div className={requestHeadingClass}>
        <h2 className="text-[15px] session:short:text-[12px] session:short:leading-[1.25]" data-testid={PERMISSION_IDS.title}>
          {t("permissionTitle", { tool: permission.toolName })}
        </h2>
        <span className="text-[12px] text-primary" data-testid={PERMISSION_IDS.remaining}>
          {t("seconds", { count: remaining })}
        </span>
      </div>
      <pre
        className="max-h-[150px] overflow-auto session:short:max-h-[24px] session:short:text-[10px] session:short:leading-[1.2]"
        data-testid={PERMISSION_IDS.input}
      >
        {JSON.stringify(permission.input, null, 2)}
      </pre>
      <div className={requestActionsClass}>
        <Button
          variant="outline"
          className={requestActionClass}
          data-testid={PERMISSION_IDS.deny}
          disabled={disabled || !remaining}
          onClick={() => decide(PermissionDecision.Deny)}
        >
          {t(PermissionDecision.Deny)}
        </Button>
        <Button
          className={requestActionClass}
          data-testid={PERMISSION_IDS.allow}
          disabled={disabled || !remaining}
          onClick={() => decide(PermissionDecision.Allow)}
        >
          {t("allowOnce")}
        </Button>
      </div>
    </section>
  )
}
