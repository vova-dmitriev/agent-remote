import type { usePairDevice } from "../model/use-pair-device"

export interface PairDeviceProps {
  controller: ReturnType<typeof usePairDevice>
  online: boolean
}
