import * as Popover from "@radix-ui/react-popover"
import { DeviceStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { SESSION_AVAILABILITY_IDS } from "@/entities/session/config/availability-test-ids"
import { useStatusDetails } from "@/entities/session/model/use-status-details"
import type { SessionAvailabilityProps } from "./session-availability.types"

export function SessionAvailability({ available }: SessionAvailabilityProps) {
  const { t } = useTranslation()
  const details = useStatusDetails()
  const label = t(available ? "sessionOnline" : "sessionOffline")

  return (
    <Popover.Root open={details.open} onOpenChange={details.onOpenChange}>
      <span className="session-availability" data-testid={SESSION_AVAILABILITY_IDS.root}>
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="session-availability-trigger"
            data-testid={SESSION_AVAILABILITY_IDS.trigger}
            data-availability={available ? DeviceStatus.Online : DeviceStatus.Offline}
            aria-label={label}
            onPointerEnter={details.onPointerEnter}
            onPointerLeave={details.onPointerLeave}
            onFocus={details.onFocus}
            onBlur={details.onBlur}
            onClick={details.onClick}
          >
            <span className="session-availability-dot" data-testid={SESSION_AVAILABILITY_IDS.dot} aria-hidden="true" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="session-status-details"
            data-testid={SESSION_AVAILABILITY_IDS.details}
            aria-label={label}
            align="end"
            sideOffset={6}
            collisionPadding={12}
            onPointerEnter={details.onPointerEnter}
            onPointerLeave={details.onPointerLeave}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {label}
          </Popover.Content>
        </Popover.Portal>
      </span>
    </Popover.Root>
  )
}
