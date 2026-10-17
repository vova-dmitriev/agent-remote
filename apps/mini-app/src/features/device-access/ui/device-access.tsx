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
    <details className="settings" data-testid={DEVICE_ACCESS_IDS.root}>
      <summary data-testid={DEVICE_ACCESS_IDS.toggle}>{t("deviceSettings")}</summary>
      {groupConnectors(connectors).map((group) => (
        <div className="connector-group" key={group.kind} data-testid={DEVICE_ACCESS_IDS.connectorGroup} data-source-kind={group.kind}>
          <div className="connector-heading">
            <span>{t(sourceNames[group.kind])}</span>
            {group.count > 1 ? <span>{t("connectorCount", { count: group.count })}</span> : null}
          </div>
          <ul className="connector-states">
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
          className="danger"
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
