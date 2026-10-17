import type { Meta, StoryObj } from "@storybook/react-vite"
import { ErrorCode } from "@protocol"
import { CommandNotice } from "./command-notice"

const meta = { component: CommandNotice, args: { error: ErrorCode.COMMAND_STATUS_UNKNOWN, busy: false, retry: () => {} } } satisfies Meta<
  typeof CommandNotice
>

export default meta
export const Uncertain: StoryObj<typeof meta> = {}
export const Checking: StoryObj<typeof meta> = { args: { busy: true } }

export const SignInRequired: StoryObj<typeof meta> = { args: { error: ErrorCode.NO_AUTHENTICATED_CLIENT } }
export const UnknownError: StoryObj<typeof meta> = { args: { error: "SYNTHETIC_UNKNOWN_ERROR" } }
