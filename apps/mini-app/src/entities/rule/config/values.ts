import { ReadyRule } from "@protocol"
import type { MessageKey } from "@/shared/lib/i18n"

/** How the app names each ready rule; the device's names are English. */
export const READY_RULE_LABELS: Record<ReadyRule, MessageKey> = {
  [ReadyRule.Database]: "readyDatabase",
  [ReadyRule.RemoveOutsideProject]: "readyRmOutside",
  [ReadyRule.ForcePush]: "readyForcePush",
  [ReadyRule.DeployMigrations]: "readyDeploy",
  [ReadyRule.Secrets]: "readySecrets",
}

/** The id the device gives a ready rule: `ready-database`. */
export const READY_RULE_PREFIX = "ready-"
