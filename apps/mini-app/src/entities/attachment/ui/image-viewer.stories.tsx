import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent, within } from "storybook/test"
import { ThemePreference, Language } from "@protocol"
import { syntheticImageUrl } from "@storybook-fixtures/attachment/media"
import { ATTACHMENT_IDS } from "../config/test-ids"
import { ImageViewer } from "./image-viewer"

const meta = {
  component: ImageViewer,
  args: { url: syntheticImageUrl, name: "Synthetic image", close: () => {}, download: () => {} },
} satisfies Meta<typeof ImageViewer>

export default meta
export const Open: StoryObj<typeof meta> = {}
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark, language: Language.En } }
export const Zoomed: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(body.getByTestId(ATTACHMENT_IDS.zoomIn))
    await userEvent.click(body.getByTestId(ATTACHMENT_IDS.zoomIn))
  },
}
