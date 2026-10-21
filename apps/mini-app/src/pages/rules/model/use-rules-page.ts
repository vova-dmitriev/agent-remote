import { useState } from "react"
import { RuleAction, type ReadyRule } from "@protocol"
import { useRulesChange, useRulesView } from "@/entities/rule"
import { rulesTabs } from "../lib/tabs"

/** The Rules page's data, its selected tab and the changes it can make. */
export function useRulesPage(deviceId: string, sessionId: string | null, online: boolean, sessionLabel: string) {
  const view = useRulesView(deviceId, sessionId, online)
  const change = useRulesChange(deviceId)
  const [selected, setSelected] = useState<string | null>(null)
  const tabs = view.data ? rulesTabs(view.data, sessionLabel) : []
  const tab = tabs.find((item) => item.id === selected) ?? tabs[0]

  return {
    view,
    tabs,
    tab,
    select: setSelected,
    busy: change.isPending,
    error: change.error?.message ?? null,
    toggle: (ready: ReadyRule, on: boolean) => tab && change.mutate({ action: RuleAction.Toggle, scope: tab.scope, ready, on }),
    remove: (id: string) => tab && change.mutate({ action: RuleAction.Delete, scope: tab.scope, id }),
    forget: (command: string) => tab && change.mutate({ action: RuleAction.ForgetCommand, scope: tab.scope, command }),
    compile: (sentence: string) => change.mutateAsync({ action: RuleAction.Compile, sentence }),
    save: (rule: { name: string; sentence: string; patterns: string[] }) =>
      tab ? change.mutateAsync({ action: RuleAction.SaveOwn, scope: tab.scope, ...rule }) : Promise.resolve(null),
  }
}
