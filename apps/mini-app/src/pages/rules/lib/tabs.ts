import { ReadyRule, RuleScopeKind, type Rule, type RulesView } from "@protocol"

/** One tab of the Rules page: a project, or the session it was opened from. */
export interface RulesTabData {
  id: string
  label: string
  scope: { kind: RuleScopeKind; key: string }
  /** The session runs with bypass permissions: inherited rules do not apply. */
  bypass: boolean
  ready: ReadyRule[]
  own: Rule[]
  /** The project's rules a session inherits. */
  inherited: Rule[]
  allowed: string[]
}

const split = (rules: Rule[]) => ({
  ready: rules.flatMap((rule) => (rule.ready ? [rule.ready] : [])),
  own: rules.filter((rule) => !rule.ready),
})

/** The session's tab first when there is one, then every project. */
export function rulesTabs(view: RulesView, sessionLabel: string): RulesTabData[] {
  const session = view.session
    ? [
        {
          id: RuleScopeKind.Session,
          label: sessionLabel,
          scope: { kind: RuleScopeKind.Session, key: view.session.id },
          bypass: view.session.bypass,
          ...split(view.session.rules),
          inherited: view.session.fromProject,
          allowed: view.session.allowed,
        },
      ]
    : []

  return [
    ...session,
    ...view.projects.map((project) => ({
      id: project.root,
      label: project.label,
      scope: { kind: RuleScopeKind.Project, key: project.root },
      bypass: false,
      ...split(project.rules),
      inherited: [],
      allowed: project.allowed,
    })),
  ]
}
