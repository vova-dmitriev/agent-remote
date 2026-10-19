import type { Meta, StoryObj } from "@storybook/react-vite"
import { delay, http, HttpResponse } from "msw"
import { userEvent } from "storybook/test"
import { AttachmentKind, ThemePreference, Language, HttpStatus } from "@protocol"
import { attachment, attachmentAccess, attachmentUrl } from "@storybook-fixtures/attachment/access"
import { syntheticImageBytes } from "@storybook-fixtures/attachment/media"
import { AttachmentCard } from "./attachment-card"
import { AttachmentProvider } from "./attachment-provider"
import { ATTACHMENT_IDS } from "../config/test-ids"

const meta = {
  component: AttachmentCard,
  args: { sessionId: "synthetic-session", attachment },
  decorators: [
    (Story) => (
      <AttachmentProvider access={attachmentAccess}>
        <Story />
      </AttachmentProvider>
    ),
  ],
  parameters: {
    msw: {
      handlers: [
        http.get(attachmentUrl + "*", () => new HttpResponse(syntheticImageBytes(), { headers: { "content-type": "image/png" } })),
      ],
    },
  },
} satisfies Meta<typeof AttachmentCard>

export default meta
type Story = StoryObj<typeof meta>
export const Image: Story = {}
export const File: Story = {
  args: {
    attachment: {
      ...attachment,
      id: "synthetic-file",
      name: "synthetic-report.pdf",
      kind: AttachmentKind.File,
      mimeType: "application/pdf",
      byteLength: 12345,
    },
  },
}
export const Viewer: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId(ATTACHMENT_IDS.image)
    await userEvent.click(canvas.getByTestId(ATTACHMENT_IDS.open))
  },
}
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(attachmentUrl + "*", async () => {
          await delay("infinite")

          return new HttpResponse()
        }),
      ],
    },
  },
}
export const Expired: Story = {
  parameters: { msw: { handlers: [http.get(attachmentUrl + "*", () => new HttpResponse(null, { status: HttpStatus.Gone }))] } },
}
export const Failed: Story = { parameters: { msw: { handlers: [http.get(attachmentUrl + "*", () => HttpResponse.error())] } } }
export const DarkEnglish: Story = { globals: { theme: ThemePreference.Dark, language: Language.En } }
export const LongFileName: Story = {
  args: { attachment: { ...attachment, name: "synthetic-very-long-attachment-filename-that-wraps-safely-on-a-narrow-mobile-screen.png" } },
}
