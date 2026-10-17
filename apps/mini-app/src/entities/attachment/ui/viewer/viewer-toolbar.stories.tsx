import type { Meta, StoryObj } from "@storybook/react-vite"
import { ThemePreference, Language } from "@protocol"
import { ViewerToolbar } from "../viewer-toolbar"

const meta = {
  component: ViewerToolbar,
  args: {
    name: "Synthetic image.png",
    percent: 125,
    zoomIn: () => {},
    zoomOut: () => {},
    fit: () => {},
    original: () => {},
    download: () => {},
    close: () => {},
  },
} satisfies Meta<typeof ViewerToolbar>

export default meta
export const Controls: StoryObj<typeof meta> = {}
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark, language: Language.En } }
