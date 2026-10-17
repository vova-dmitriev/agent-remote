import type { ComponentProps } from "react"
import * as Menu from "@radix-ui/react-dropdown-menu"
import type { TestAttributes } from "../types"

export function MenuContent(props: ComponentProps<typeof Menu.Content> & TestAttributes) {
  return (
    <Menu.Portal>
      <Menu.Content align="end" sideOffset={8} collisionPadding={12} className="dropdown-menu" {...props} />
    </Menu.Portal>
  )
}
