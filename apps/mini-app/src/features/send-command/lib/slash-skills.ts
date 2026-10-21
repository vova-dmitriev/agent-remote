import type { SessionSkill } from "@protocol"

export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith("/") || caret < 1 || caret > text.length) return null
  const end = text.search(/\s/u)

  if (end !== -1 && caret > end) return null

  return text.slice(1, caret)
}

export function matchingSkills(skills: SessionSkill[], query: string) {
  const needle = query.toLowerCase()

  return skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(needle))
}

export function insertSkill(text: string, invocation: string) {
  const end = text.search(/\s/u)
  const tail = end === -1 ? " " : text.slice(end)

  return { text: invocation + tail, caret: invocation.length + 1 }
}
