import { RotateCcw } from "lucide-react"
import { sourceObserved, sourceSessionId } from "@/entities/session"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { noticeVariants } from "@/shared/ui/notice"
import { SESSION_CREATE_IDS } from "@/features/create-session/config/test-ids"
import { useProjectStart } from "@/features/create-session/model/use-project-start"
import type { ResumeSessionProps } from "../session-creation.types"

/** A dead session's way back: continues its conversation in a new session, which then replaces it in the lists. */
export function ResumeSession({ session, online, onResume }: ResumeSessionProps) {
  const { t } = useTranslation()
  const { starting, error, start } = useProjectStart()
  const id = sourceSessionId(session)

  if (sourceObserved(session) || !id || !session.cwd || !onResume) return null

  return (
    <div className="flex flex-none flex-col items-center gap-[6px] py-[8px]">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={SESSION_CREATE_IDS.resumeSession}
        disabled={!online || starting}
        onClick={() => void start(() => onResume(session, id))}
      >
        <RotateCcw aria-hidden="true" size={14} />
        {t(starting ? "resumeSessionStarting" : "resumeSession")}
      </Button>
      {error ? (
        <p className={noticeVariants()} role="alert" data-testid={SESSION_CREATE_IDS.resumeSessionError}>
          {feedbackText(error, t)}
        </p>
      ) : null}
    </div>
  )
}
