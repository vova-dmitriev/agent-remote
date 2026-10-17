import type { Meta, StoryObj } from "@storybook/react-vite"
import { UnavailableAttachment } from "./unavailable-attachment"

const meta = { component: UnavailableAttachment, args: { name: "synthetic-report.pdf" } } satisfies Meta<typeof UnavailableAttachment>

export default meta

export const Default: StoryObj<typeof meta> = {}
