import type { Meta, StoryObj } from "@storybook/react-vite"
import { screen, userEvent } from "storybook/test"
import {
  AgentProvider,
  CapabilitySupport,
  ProfileAuthMode,
  ProfileStatus,
  ReasoningEffort,
  ThemePreference,
  type ProfileList,
} from "@protocol"
import { allSources } from "@storybook-fixtures/page-states"
import { SESSION_CREATE_IDS } from "../config/test-ids"
import { SessionCreation } from "./session-creation"

const profileData: ProfileList = {
  available: true,
  observedAt: 1,
  profiles: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      ownerId: "synthetic-owner",
      deviceId: "synthetic-device",
      provider: AgentProvider.Codex,
      authMode: ProfileAuthMode.Subscription,
      label: "Work account",
      status: ProfileStatus.Ready,
      identity: { accountRef: "synthetic-account", accountLabel: "Work workspace", verifiedAt: 1 },
      capabilities: { isolation: CapabilitySupport.Supported, createSession: true, contextSeed: false, resume: false, quota: false },
      models: [{ id: "gpt-synthetic", efforts: [ReasoningEffort.Low, ReasoningEffort.High] }],
      version: 3,
      updatedAt: 1,
    },
  ],
  operations: [],
  defaults: { [AgentProvider.Claude]: null, [AgentProvider.Codex]: null },
}

const meta = {
  component: SessionCreation,
  args: {
    sessions: allSources.map((session) => ({
      ...session,
      cwd: "/synthetic/project",
      capabilities: { ...session.capabilities, createSession: true },
    })),
    disabled: false,
    online: true,
    profileData,
    create: () => {},
  },
} satisfies Meta<typeof SessionCreation>

export default meta
type Story = StoryObj<typeof meta>

/** Opens a chip dropdown and picks the item whose data-value matches; menus render in a portal outside the canvas. */
async function choose(trigger: HTMLElement, optionId: string, value: string) {
  await userEvent.click(trigger)
  const option = (await screen.findAllByTestId(optionId)).find((item) => item.dataset.value === value)

  if (option) await userEvent.click(option)
}

export const Collapsed: Story = {}
export const Inline: Story = { args: { inline: true } }
export const Open: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.toggle))
  },
}
export const ProfileLaunch: Story = {
  ...Open,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.toggle))
    await choose(canvas.getByTestId(SESSION_CREATE_IDS.profile.trigger), SESSION_CREATE_IDS.profileOption, profileData.profiles[0]!.id)
    await choose(canvas.getByTestId(SESSION_CREATE_IDS.model.trigger), SESSION_CREATE_IDS.modelOption, "gpt-synthetic")
    await choose(canvas.getByTestId(SESSION_CREATE_IDS.effort.trigger), SESSION_CREATE_IDS.effortOption, ReasoningEffort.High)
  },
}
export const Busy: Story = { ...Open, args: { disabled: true } }
export const Dark: Story = { ...Open, globals: { theme: ThemePreference.Dark } }
export const LongProjectPath: Story = {
  args: {
    sessions: allSources.map((session) => ({
      ...session,
      cwd: "/private/var/folders/" + "synthetic-long-directory-".repeat(10) + "/project",
      capabilities: { ...session.capabilities, createSession: true },
    })),
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.toggle))
    await userEvent.click(canvas.getByTestId(SESSION_CREATE_IDS.project.trigger))
  },
}
