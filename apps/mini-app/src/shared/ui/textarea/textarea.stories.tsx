import type { Meta, StoryObj } from "@storybook/react-vite"
import { Textarea } from "./textarea"
import { SHARED_UI_IDS } from "../test-ids"

const meta = { component: Textarea, args: { "aria-label": "Example message", "data-testid": SHARED_UI_IDS.textarea } } satisfies Meta<
  typeof Textarea
>

export default meta
export const Default: StoryObj<typeof meta> = {}
