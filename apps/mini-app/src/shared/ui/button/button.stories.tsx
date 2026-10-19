import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import { SHARED_UI_IDS } from "../test-ids"

const meta = { component: Button, args: { children: "Continue", "data-testid": SHARED_UI_IDS.button } } satisfies Meta<typeof Button>

export default meta
export const Default: StoryObj<typeof meta> = {}
