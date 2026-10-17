import type { Meta, StoryObj } from "@storybook/react-vite"
import { Language, ThemePreference } from "@protocol"
import { SignInPage } from "./sign-in-page"

const meta = { component: SignInPage } satisfies Meta<typeof SignInPage>

export default meta
export const SignedOut: StoryObj<typeof meta> = {}
export const English: StoryObj<typeof meta> = { globals: { language: Language.En } }
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }
