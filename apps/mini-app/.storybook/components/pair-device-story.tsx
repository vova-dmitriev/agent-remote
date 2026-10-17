import { PairDevice, usePairDevice } from "@/features/pair-device"
import { useSessionStore } from "@/entities/session"
import { useSyntheticRuntime } from "../model/use-synthetic-runtime"

export function PairDeviceStory() {
  useSyntheticRuntime()
  const result = useSessionStore((state) => state.error || state.result)
  const controller = usePairDevice()

  return (
    <>
      <PairDevice controller={controller} online />
      <p role="status">{result}</p>
    </>
  )
}
