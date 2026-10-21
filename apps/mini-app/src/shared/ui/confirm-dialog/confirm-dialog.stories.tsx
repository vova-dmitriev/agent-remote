import type { Meta, StoryObj } from "@storybook/react-vite"
import { ConfirmDialog } from "./confirm-dialog"

const meta = {
  component: ConfirmDialog,
  args: {
    open: true,
    title: "Sign out of Agent Remote?",
    description: "To come back, open the app from Telegram again.",
    confirmLabel: "Sign out",
    cancelLabel: "Cancel",
    onConfirm: () => {},
    onCancel: () => {},
    testIds: { root: "example-confirm", confirm: "example-confirm-yes", cancel: "example-confirm-no" },
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
export const Open: StoryObj<typeof meta> = {}
