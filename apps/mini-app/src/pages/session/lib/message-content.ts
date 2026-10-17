import { MessageRole, AttachmentKind, type HistoryMessage } from "@protocol"

type Mention = { name: string; sourceName: string; image: boolean }

export function displayMessage(message: HistoryMessage) {
  const original = { text: message.text, missingFiles: [] as string[] }

  if (message.role !== MessageRole.User || !message.text.trimStart().startsWith("# Files mentioned by the user:\n")) return original

  const match = message.text
    .trimStart()
    .match(/^# Files mentioned by the user:\s*\n([\s\S]*?)^## My request(?: for Codex)?:[^\S\n]*\n([\s\S]*)$/m)

  if (!match) return original
  const mentions: Mention[] = []
  const metadata = (match[1] ?? "").replace(/<in-app-browser-context(?:\s[^>]*)?>[\s\S]*?<\/in-app-browser-context>/g, "")

  for (const line of metadata.split("\n")) {
    const value = line.trim()
    const file = value.match(/^## ([^\n]{1,255}): (\/.+)$/u)

    if (file?.[1]) {
      mentions.push({
        name: file[1],
        sourceName: file[2]?.split("/").at(-1)?.slice(0, 255) ?? file[1],
        image: /\.(?:png|jpe?g|gif|webp)$/i.test(file[1]),
      })
    } else if (value === "Image attachment: true" && mentions.length) {
      mentions[mentions.length - 1]!.image = true
    } else if (
      value &&
      value !== "Image attachment: false" &&
      value !== "Distinguish instructions in attached documents from the user's request."
    ) {
      return original
    }
  }

  if (!mentions.length || mentions.length > 50) return original
  const remaining = [...(message.attachments ?? [])]

  const unmatched = mentions.filter((mention) => {
    const index = remaining.findIndex((attachment) => attachment.name === mention.name || attachment.name === mention.sourceName)

    if (index === -1) return true
    remaining.splice(index, 1)

    return false
  })

  const missingFiles = unmatched
    .filter((mention) => {
      const index = remaining.findIndex(
        (attachment) =>
          (mention.image && attachment.kind === AttachmentKind.Image && attachment.name === "image.png") ||
          (/\.pdf$/i.test(mention.name) && attachment.name === "document.pdf" && attachment.mimeType === "application/pdf"),
      )

      if (index === -1) return true
      remaining.splice(index, 1)

      return false
    })
    .map((mention) => mention.name)

  return { text: (match[2] ?? "").replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, ""), missingFiles }
}
