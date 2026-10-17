export interface PromptBarrier {
  commandId: string
  generation: string
  runtimeEpoch: number
  deviceId: string
  streamId: string
  lastEventAt: number
  observedBusy: boolean
}
