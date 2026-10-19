import { NativeRestartState } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { COMMAND_IDS as IDS } from "@/features/send-command/config/test-ids"
import type { NativeInputHelpProps } from "./native-input-help.types"

export function NativeInputHelp({ session, onRestart, disabled = true }: NativeInputHelpProps) {
  const { t } = useTranslation()

  return (
    <div className="text-[12px] text-muted-foreground" data-testid={IDS.connectionHint}>
      {session.capabilities.restartSession ? (
        <>
          <Button type="button" variant="outline" size="sm" data-testid={IDS.restartSession} onClick={onRestart} disabled={disabled}>
            {t("restartWithInput")}
          </Button>
          <p className="mb-[8px]">{t("restartWithInputHint")}</p>
        </>
      ) : (
        <p className="mb-[8px]">
          {t(session.nativeRestartState === NativeRestartState.Ambiguous ? "nativeRestartAmbiguous" : "nativeRestartUnavailable")}
        </p>
      )}
    </div>
  )
}
