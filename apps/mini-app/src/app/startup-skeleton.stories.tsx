import type { Meta, StoryObj } from "@storybook/react-vite"
import { ThemePreference } from "@protocol"
import { StartupSkeleton } from "./startup-skeleton"

const meta = { component: StartupSkeleton } satisfies Meta<typeof StartupSkeleton>

export default meta
export const Loading: StoryObj<typeof meta> = {}
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }
