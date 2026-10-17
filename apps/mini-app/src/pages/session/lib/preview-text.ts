export function previewText(text: string) {
  let content = text.trim()

  if (/^<pasted_content(?:\s|>)/.test(content)) {
    content = content.replace(/^<pasted_content(?:\s+[^>]*)?>\s*/, "").replace(/\s*<\/pasted_content>$/, "")
  }

  const notification = content.match(/^<task-notification>\s*([\s\S]*?)\s*<\/task-notification>([\s\S]*)$/)

  if (notification) {
    const body = (notification[1] ?? "").replace(/<(task-id|tool-use-id|output-file)>[\s\S]*?<\/\1>/g, "")
    const summary = body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim()
    const result = body.match(/<(result|output)>([\s\S]*?)<\/\1>/)?.[2]?.trim()
    const fallback = body.replace(/<\/?(?:status|summary|result|output)>/g, "\n\n").trim()

    content = [summary || result ? [summary, result].filter(Boolean).join("\n\n") : fallback, notification[2]?.trim()]
      .filter(Boolean)
      .join("\n\n")
  }

  content = content.trim()

  if (content.length <= 1600) return content

  const snippet = content.slice(0, 1600).replace(/[\uD800-\uDBFF]$/, "")

  return snippet + "…"
}
