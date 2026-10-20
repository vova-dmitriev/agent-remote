import type { Session } from "@protocol"

export interface SessionFilePageProps {
  session: Session
  path: string
  onBack: () => void
}
