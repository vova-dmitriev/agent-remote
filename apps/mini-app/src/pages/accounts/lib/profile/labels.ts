import { ProfileStatus, ProfileOperationPhase } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"

export const profileStatusLabel: Record<ProfileStatus, MessageKey> = {
  [ProfileStatus.Ready]: "accountsReady",
  [ProfileStatus.NeedsAuthentication]: "accountsNeedsAuth",
  [ProfileStatus.Disabled]: "accountsDisabled",
  [ProfileStatus.Removing]: "accountsRemoving",
  [ProfileStatus.Removed]: "accountsRemoved",
}

export const profilePhaseLabel: Record<ProfileOperationPhase, MessageKey> = {
  [ProfileOperationPhase.Preparing]: "accountsPreparing",
  [ProfileOperationPhase.AwaitingAuthentication]: "accountsWaiting",
  [ProfileOperationPhase.Removing]: "accountsRemoving",
  [ProfileOperationPhase.Complete]: "accountsComplete",
  [ProfileOperationPhase.Failed]: "accountsFailed",
  [ProfileOperationPhase.Unknown]: "accountsUnknown",
}
