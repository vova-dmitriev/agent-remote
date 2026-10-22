export interface LinkClientPageProps {
  /** The server this build links to. */
  server: string
  onLinked: (refresh: string) => void
  /** Falls back to the Agent Remote companion on this Mac. */
  onUseCompanion: () => void
}
