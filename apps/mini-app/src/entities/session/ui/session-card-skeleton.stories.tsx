import type { Meta, StoryObj } from "@storybook/react-vite"
import { SessionCardSkeleton } from "./session-card-skeleton"

const meta = { component: SessionCardSkeleton } satisfies Meta<typeof SessionCardSkeleton>

export default meta
export const Loading: StoryObj<typeof meta> = {}
