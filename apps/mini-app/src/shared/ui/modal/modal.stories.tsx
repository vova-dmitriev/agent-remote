import type { Meta, StoryObj } from "@storybook/react-vite"
import { Modal } from "./modal"

const meta = {
  component: Modal,
  args: { open: true, title: "Synthetic choice", onClose: () => undefined, testId: "example-modal", children: <p>Example content</p> },
} satisfies Meta<typeof Modal>

export default meta
export const Open: StoryObj<typeof meta> = {}
