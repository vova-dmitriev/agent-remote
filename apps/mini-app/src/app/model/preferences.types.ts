import type { PreferencePatch } from "@protocol"
import type { RuntimeLease } from "@/shared/lib/runtime"

export interface PreferenceMutationInput {
  lease: RuntimeLease
  patch: PreferencePatch
}
