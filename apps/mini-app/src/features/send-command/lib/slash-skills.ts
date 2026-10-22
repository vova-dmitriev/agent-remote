import type { SessionSkill } from "@protocol"

/** Characters of a skill name; a second slash (a path such as /usr/bin) ends the completion. */
const SKILL_NAME = /^[\p{L}\p{N}_:.-]*$/u

/**
 * The slash token under the caret, anywhere in the text: a "/" at the start or after whitespace, then skill-name
 * characters up to the caret. A slash inside a word (src/app) starts none.
 */
function slashToken(text: string, caret: number) {
  if (caret < 1 || caret > text.length) return null
  const match = /(^|\s)\/(\S*)$/u.exec(text.slice(0, caret))

  if (!match || !SKILL_NAME.test(match[2]!)) return null
  const start = match.index + match[1]!.length
  const rest = text.slice(start).search(/\s/u)

  return { start, end: rest === -1 ? text.length : start + rest, query: match[2]! }
}

export function slashQuery(text: string, caret: number): string | null {
  return slashToken(text, caret)?.query ?? null
}

export function matchingSkills(skills: SessionSkill[], query: string) {
  const needle = query.toLowerCase()

  return skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(needle))
}

/** Replaces the slash token under the caret with the invocation and leaves the caret after it and one space. */
export function insertSkill(text: string, invocation: string, caret: number) {
  const token = slashToken(text, caret) ?? { start: 0, end: text.search(/\s/u) === -1 ? text.length : text.search(/\s/u) }
  const tail = text.slice(token.end)
  const spaced = /^\s/u.test(tail) ? tail : " " + tail

  return { text: text.slice(0, token.start) + invocation + spaced, caret: token.start + invocation.length + 1 }
}
