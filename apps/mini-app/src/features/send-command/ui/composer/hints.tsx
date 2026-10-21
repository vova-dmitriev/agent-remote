import { CommandActionType, ConnectionStatus, DeviceStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { mutedTextClass } from "@/shared/ui/text"
import { composerState } from "@/features/send-command/lib/composer-state"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import type { SessionComposerProps } from "@/features/send-command/ui/types"
import { NativeInputHelp } from "../native-input/native-input-help"

export interface ComposerHintsProps {
  controller: SessionComposerProps["controller"]
  session: SessionComposerProps["session"]
  connection: SessionComposerProps["connection"]
  deviceStatus: SessionComposerProps["deviceStatus"]
  state: ReturnType<typeof composerState>
  t: ReturnType<typeof useTranslation>["t"]
}

export function ComposerHints({ controller, session, connection, deviceStatus, state, t }: ComposerHintsProps) {
  return (
    <>
      {state.showNativeHint ? (
        <NativeInputHelp
          session={session}
          onRestart={() => void controller.action({ type: CommandActionType.RestartSession })}
          disabled={
            controller.busy ||
            controller.awaitingReceipt ||
            controller.uncertain ||
            connection !== ConnectionStatus.Online ||
            deviceStatus !== DeviceStatus.Online
          }
        />
      ) : null}
      {state.unavailableHint && !state.showNativeHint ? (
        <p className={mutedTextClass} data-testid={COMMAND_IDS.availabilityHint}>
          {t(state.unavailableHint)}
        </p>
      ) : null}
    </>
  )
}
