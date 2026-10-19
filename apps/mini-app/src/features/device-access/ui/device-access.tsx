import { useTranslation } from "@/shared/lib/hooks"
import { sourceNames, connectorStates } from "@/entities/session"
import { Button } from "@/shared/ui/button"
import { feedbackText } from "@/shared/lib/i18n"
import { DEVICE_ACCESS_IDS } from "../config/test-ids"
import { groupConnectors } from "../lib/group-connectors"
import type { DeviceAccessProps } from "./device-access.types"

export function DeviceAccess({ devices, connectors, revoke }: DeviceAccessProps) {
  const { t } = useTranslation()

  return (
    <details className="mt-[25px] text-[12px] text-muted-foreground" data-testid={DEVICE_ACCESS_IDS.root}>
      <summary data-testid={DEVICE_ACCESS_IDS.toggle}>{t("deviceSettings")}</summary>
      {groupConnectors(connectors).map((group) => (
        <div className="mt-[14px]" key={group.kind} data-testid={DEVICE_ACCESS_IDS.connectorGroup} data-source-kind={group.kind}>
          <div className="flex flex-wrap justify-between gap-x-[12px] gap-y-[4px] font-medium text-foreground">
            <span>{t(sourceNames[group.kind])}</span>
            {group.count > 1 ? (
              <span className="font-normal text-muted-foreground">{t("connectorCount", { count: group.count })}</span>
            ) : null}
          </div>
          <ul className="mt-[4px] grid list-none gap-[4px] leading-[1.5]">
            {group.statuses.map((status) => (
              <li
                key={JSON.stringify([status.state, status.reason])}
                data-testid={DEVICE_ACCESS_IDS.connectorState}
                data-state={status.state}
              >
                {t(connectorStates[status.state])}
                {group.statuses.length > 1 ? " · " + t("connectorCount", { count: status.count }) : ""}
                {status.reason ? " — " + feedbackText(status.reason, t) : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {devices.map((device) => (
        <Button
          key={device.id}
          variant="destructive"
          className="mt-[18px] rounded-[8px] border border-border bg-transparent px-[18px] py-[12px] text-[13px] font-semibold text-danger hover:bg-transparent focus-visible:border-border dark:bg-transparent"
          data-testid={DEVICE_ACCESS_IDS.revoke}
          data-device-id={device.id}
          onClick={() => revoke(device.id)}
        >
          {t("revoke")}
        </Button>
      ))}
    </details>
  )
}
