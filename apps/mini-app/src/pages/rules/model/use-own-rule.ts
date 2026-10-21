import { useState } from "react"
import type { RulesReply } from "@protocol"

interface OwnRuleActions {
  compile: (sentence: string) => Promise<RulesReply>
  save: (rule: { name: string; sentence: string; patterns: string[] }) => Promise<unknown>
}

const isDraft = (reply: RulesReply): reply is { name: string; patterns: string[] } => "patterns" in reply

/** An own rule from words: the sentence, the drafted name and patterns the owner confirms or edits, then saved. */
export function useOwnRule({ compile, save }: OwnRuleActions) {
  const [open, setOpen] = useState(false)
  const [sentence, setSentence] = useState("")
  const [name, setName] = useState("")
  const [patterns, setPatterns] = useState("")
  const [drafted, setDrafted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setOpen(false)
    setSentence("")
    setName("")
    setPatterns("")
    setDrafted(false)
    setError(null)
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)

    try {
      await work()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return {
    open,
    sentence,
    name,
    patterns,
    drafted,
    busy,
    error,
    start: () => setOpen(true),
    cancel: reset,
    setSentence,
    setName,
    setPatterns,
    compile: () =>
      run(async () => {
        const reply = await compile(sentence.trim())

        if (isDraft(reply)) {
          setName(reply.name)
          setPatterns(reply.patterns.join("\n"))
          setDrafted(true)
        }
      }),
    save: () =>
      run(async () => {
        const lines = patterns
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)

        await save({ name: name.trim(), sentence: sentence.trim(), patterns: lines })
        reset()
      }),
  }
}

export type OwnRuleController = ReturnType<typeof useOwnRule>
