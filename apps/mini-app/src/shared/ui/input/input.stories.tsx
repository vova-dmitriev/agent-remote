import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "./input"
import { SHARED_UI_IDS } from "../test-ids"

const meta = {
  component: Input,
  args: { placeholder: "Synthetic input", "aria-label": "Example input", "data-testid": SHARED_UI_IDS.input },
} satisfies Meta<typeof Input>

export default meta
export const Default: StoryObj<typeof meta> = {}
