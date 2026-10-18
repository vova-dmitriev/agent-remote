import type { ApplicationClient } from "@/shared/api"

export interface RuntimeLease {
  readonly client: ApplicationClient
  readonly epoch: number
}
