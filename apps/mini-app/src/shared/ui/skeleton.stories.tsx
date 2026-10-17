import type { Meta, StoryObj } from "@storybook/react-vite"
import { Skeleton } from "./skeleton"
import { SHARED_UI_IDS } from "./test-ids"

const meta = { component: Skeleton, args: { className: "h-6 w-40", "data-testid": SHARED_UI_IDS.skeleton } } satisfies Meta<typeof Skeleton>

export default meta
export const Default: StoryObj<typeof meta> = {}
