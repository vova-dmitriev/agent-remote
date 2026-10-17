import type { Meta, StoryObj } from "@storybook/react-vite"
import { ColorScheme } from "@protocol"
import { HistorySkeleton } from "./history-skeleton"

const meta = { component: HistorySkeleton } satisfies Meta<typeof HistorySkeleton>

export default meta
export const Loading: StoryObj<typeof meta> = {}
export const English: StoryObj<typeof meta> = { globals: { language: "en" } }
export const Dark: StoryObj<typeof meta> = { globals: { theme: ColorScheme.Dark } }
