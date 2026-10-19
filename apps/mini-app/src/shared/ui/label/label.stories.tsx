import type { Meta, StoryObj } from "@storybook/react-vite"
import { Label } from "./label"
import { SHARED_UI_IDS } from "../test-ids"

const meta = { component: Label, args: { children: "Message", "data-testid": SHARED_UI_IDS.label } } satisfies Meta<typeof Label>

export default meta
export const Default: StoryObj<typeof meta> = {}
