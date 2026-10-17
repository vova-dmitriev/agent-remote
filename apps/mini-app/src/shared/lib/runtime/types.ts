import type { AppTransport } from "@/shared/api"

export interface RuntimeLease {
  readonly client: AppTransport
  readonly epoch: number
}
