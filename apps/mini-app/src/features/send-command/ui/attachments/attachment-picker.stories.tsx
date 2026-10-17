import type { Meta, StoryObj } from "@storybook/react-vite"
import { delay, http, HttpResponse } from "msw"
import { userEvent } from "storybook/test"
import { AttachmentKind, ThemePreference, Language, ErrorCode } from "@protocol"
import { AttachmentComposerStory } from "@storybook-components/attachment-composer-story"
import { syntheticImageBytes } from "@storybook-fixtures/attachment/media"
import { COMMAND_IDS } from "@/features/send-command"
import { UPLOAD_IDS } from "./test-ids"

const uploadUrl = "http://api.storybook.local/sessions/*/attachments"

const success = http.post(uploadUrl, async ({ request }) =>
  HttpResponse.json({
    id: request.headers.get("x-upload-id"),
    name: decodeURIComponent(request.headers.get("x-file-name") ?? "synthetic.png"),
    mimeType: request.headers.get("content-type"),
    byteLength: (await request.arrayBuffer()).byteLength,
    sha256: "0".repeat(64),
    kind: request.headers.get("content-type")?.startsWith("image/") ? AttachmentKind.Image : AttachmentKind.File,
  }),
)

const file = () => new File([syntheticImageBytes()], "synthetic.png", { type: "image/png" })

const meta = { component: AttachmentComposerStory, parameters: { msw: { handlers: [success] } } } satisfies Meta<
  typeof AttachmentComposerStory
>

export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const SelectedImage: Story = {
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByTestId(UPLOAD_IDS.input), file())
  },
}
export const Multiple: Story = {
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByTestId(UPLOAD_IDS.input), [
      file(),
      new File(["synthetic"], "synthetic-document.txt", { type: "text/plain" }),
    ])
  },
}
export const Uploading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(uploadUrl, async () => {
          await delay("infinite")

          return new HttpResponse()
        }),
      ],
    },
  },
  play: SelectedImage.play!,
}
export const Failed: Story = {
  parameters: { msw: { handlers: [http.post(uploadUrl, () => HttpResponse.json({ code: ErrorCode.ATTACHMENT_QUOTA }, { status: 413 }))] } },
  play: SelectedImage.play!,
}
export const Retry: Story = {
  parameters: {
    msw: {
      handlers: [http.post(uploadUrl, () => HttpResponse.json({ code: ErrorCode.UPLOAD_BUSY }, { status: 429 }), { once: true }), success],
    },
  },
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByTestId(UPLOAD_IDS.input), file())
    await userEvent.click(await canvas.findByTestId(UPLOAD_IDS.retry))
  },
}
export const Remove: Story = {
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByTestId(UPLOAD_IDS.input), file())
    await userEvent.click(canvas.getByTestId(UPLOAD_IDS.remove))
  },
}
export const WithTextDark: Story = {
  globals: { theme: ThemePreference.Dark, language: Language.En },
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByTestId(UPLOAD_IDS.input), file())
    await userEvent.type(canvas.getByTestId(COMMAND_IDS.prompt), "Review this synthetic image")
  },
}
export const CountLimit: Story = {
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByTestId(UPLOAD_IDS.input), Array.from({ length: 6 }, file))
  },
}
