import { useEffect, useRef, useState } from "react"
import type { PendingUserInput, UserInputAnswers } from "@protocol"
import { questionAnswers, type QuestionChoice, type QuestionChoices } from "@/pages/session/lib/questions/question-answers"

export function useAnswerQuestion(request: PendingUserInput, disabled: boolean, answer: (answers: UserInputAnswers) => Promise<void>) {
  const [choices, setChoices] = useState<QuestionChoices>({})
  const [now, setNow] = useState(Date.now)
  const sending = useRef(false)
  const answers = questionAnswers(request.questions, choices)
  const remaining = Math.max(0, Math.ceil((request.expiresAt - now) / 1000))
  const blocked = disabled || !remaining

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])

  function choose(id: string, choice: QuestionChoice) {
    setChoices((current) => ({ ...current, [id]: choice }))
  }

  async function send(skip = false) {
    if (blocked || sending.current || Date.now() >= request.expiresAt || (!skip && !answers)) return
    sending.current = true

    try {
      await answer(skip ? {} : answers!)
    } finally {
      sending.current = false
    }
  }

  return { choices, choose, remaining, blocked, ready: !!answers, send }
}
