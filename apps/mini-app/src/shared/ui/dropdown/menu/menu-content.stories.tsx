import type { Meta, StoryObj } from "@storybook/react-vite"
import * as Menu from "@radix-ui/react-dropdown-menu"
import { ThemePreference } from "@protocol"
import { Button } from "@/shared/ui/button"
import { MenuContent } from "./menu-content"
import { DROPDOWN_IDS } from "../test-ids"
import { menuItemClass } from "./menu-item-class"

const meta = {
  component: MenuContent,
  args: {
    "data-testid": DROPDOWN_IDS.panel,
    children: (
      <Menu.Item className={menuItemClass} data-testid={DROPDOWN_IDS.first}>
        Synthetic action
      </Menu.Item>
    ),
  },
  decorators: [
    (Story) => (
      <Menu.Root defaultOpen modal={false}>
        <Menu.Trigger asChild>
          <Button data-testid={DROPDOWN_IDS.trigger}>Synthetic menu</Button>
        </Menu.Trigger>
        <Story />
      </Menu.Root>
    ),
  ],
} satisfies Meta<typeof MenuContent>

export default meta
export const Open: StoryObj<typeof meta> = {}
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }
