import * as Popover from "@radix-ui/react-popover"
import { DeviceStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { SESSION_AVAILABILITY_IDS } from "@/entities/session/config/availability-test-ids"
import { useStatusDetails } from "@/entities/session/model/use-status-details"
import type { SessionAvailabilityProps } from "./session-availability.types"

export function SessionAvailability({ available }: SessionAvailabilityProps) {
  const { t } = useTranslation()
  const details = useStatusDetails()
  const label = t(available ? "sessionOnline" : "sessionOffline")

  return (
    <Popover.Root open={details.open} onOpenChange={details.onOpenChange}>
      <span className="inline-flex flex-none" data-testid={SESSION_AVAILABILITY_IDS.root}>
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-[32px] rounded-full p-0"
            data-testid={SESSION_AVAILABILITY_IDS.trigger}
            data-availability={available ? DeviceStatus.Online : DeviceStatus.Offline}
            aria-label={label}
            onPointerEnter={details.onPointerEnter}
            onPointerLeave={details.onPointerLeave}
            onFocus={details.onFocus}
            onBlur={details.onBlur}
            onClick={details.onClick}
          >
            <span
              className={cn("size-[8px] rounded-full", available ? "bg-status-ready" : "bg-danger")}
              data-testid={SESSION_AVAILABILITY_IDS.dot}
              aria-hidden="true"
            />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-[70] max-w-[min(240px,calc(100vw_-_24px))] rounded-[10px] border border-border bg-surface px-[12px] py-[9px] text-[12px] leading-[1.4] text-foreground shadow-[0_6px_24px_color-mix(in_srgb,var(--foreground)_12%,transparent)]"
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
