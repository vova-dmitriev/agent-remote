import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { AgentName } from "@/entities/session"
import { MessageRole } from "@protocol"
import { SESSION_FEED_IDS } from "@/pages/session/config/test-ids"
import { MessageRail } from "./message-rail"

const ROW = 133
const VIEWPORT = 320

/** Synthetic feed geometry: `count` rows of equal height and a viewport scrolled to `scrollTop`. */
function feed(count: number, scrollTop: number) {
  const total = count * ROW

  return {
    messages: Array.from({ length: count }, (_, index) => ({
      id: "synthetic-" + index,
      role: index % 2 ? MessageRole.Assistant : MessageRole.User,
      text: "Example " + index,
      occurredAt: index,
    })),
    starts: Array.from({ length: count }, (_, index) => index * ROW),
    total,
    viewport: {
      scrollTop: Math.min(scrollTop, Math.max(0, total - VIEWPORT)),
      clientHeight: VIEWPORT,
      scrollHeight: Math.max(total, VIEWPORT),
    },
  }
}

const meta = {
  component: MessageRail,
  decorators: [
    (Story) => (
      <div className="relative h-80">
        <Story />
      </div>
    ),
  ],
  args: {
    ...feed(35, 3 * ROW),
    agent: AgentName.Claude,
    activeId: "synthetic-3",
    older: false,
    newer: false,
    jump: () => undefined,
    loadPage: () => undefined,
  },
} satisfies Meta<typeof MessageRail>

export default meta
export const Navigation: StoryObj<typeof meta> = {}

export const LongHistory: StoryObj<typeof meta> = { args: { ...feed(300, 150 * ROW), activeId: "synthetic-150" } }

export const FewMessages: StoryObj<typeof meta> = { args: { ...feed(2, 0), activeId: null } }

const moreHistory = { ...feed(100, 50 * ROW), activeId: "synthetic-50", older: true, newer: true }

export const MoreHistory: StoryObj<typeof meta> = { args: moreHistory }

export const JumpDismissesPreview: StoryObj<typeof meta> = {
  play: async ({ canvas }) => {
    const marker = canvas.getAllByTestId(SESSION_FEED_IDS.marker)[3]!

    await userEvent.hover(marker)
    await userEvent.click(marker)
  },
}

export const LoadEarlierHistory: StoryObj<typeof meta> = {
  args: moreHistory,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getAllByTestId(SESSION_FEED_IDS.railCap)[0]!)
  },
}
