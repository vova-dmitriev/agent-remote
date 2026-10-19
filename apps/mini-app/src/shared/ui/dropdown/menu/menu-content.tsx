import type { ComponentProps } from "react"
import * as Menu from "@radix-ui/react-dropdown-menu"
import type { TestAttributes } from "@/shared/ui/types"

export function MenuContent(props: ComponentProps<typeof Menu.Content> & TestAttributes) {
  return (
    <Menu.Portal>
      <Menu.Content
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="z-[80] max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[min(calc(100vw_-_24px),var(--radix-dropdown-menu-content-available-width))] min-w-[210px] overflow-y-auto rounded-[14px] border border-border bg-surface p-[6px] text-foreground shadow-[0_12px_36px_color-mix(in_srgb,var(--foreground)_14%,transparent)] outline-none"
        {...props}
      />
    </Menu.Portal>
  )
}
