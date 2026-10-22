/** A search snippet split into the parts that match the words (case-insensitive) and the parts between. */
export function matchParts(text: string, query: string) {
  const needle = query.trim().toLowerCase()
  const parts: { text: string; match: boolean }[] = []
  const lower = text.toLowerCase()
  let at = 0

  for (let found = needle ? lower.indexOf(needle) : -1; found >= 0; found = lower.indexOf(needle, at)) {
    if (found > at) parts.push({ text: text.slice(at, found), match: false })
    parts.push({ text: text.slice(found, found + needle.length), match: true })
    at = found + needle.length
  }

  if (at < text.length) parts.push({ text: text.slice(at), match: false })

  return parts
}
