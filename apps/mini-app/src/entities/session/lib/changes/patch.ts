import { PatchLineKind } from "./line-kind"

const languages: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  json: "json",
  css: "css",
  html: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  swift: "swift",
  sql: "sql",
  md: "markdown",
}

export function patchMarkdown(path: string, patch: string): string {
  const language = languages[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "plaintext"
  const fence = "`".repeat(Math.max(3, ...Array.from(patch.matchAll(/`+/g), (match) => match[0].length + 1)))

  return `${fence}${language}\n${patch}\n${fence}`
}

export function patchKind(line: string): PatchLineKind {
  if (/^(\+\+\+|---)(?:\s|$)/u.test(line)) return PatchLineKind.Context
  if (line.startsWith("+")) return PatchLineKind.Add
  if (line.startsWith("-")) return PatchLineKind.Delete
  if (line.startsWith("@@")) return PatchLineKind.Hunk

  return PatchLineKind.Context
}

export function patchStats(patch: string) {
  let added = 0
  let deleted = 0

  for (const line of patch.split("\n")) {
    if (patchKind(line) === PatchLineKind.Add) added++
    if (patchKind(line) === PatchLineKind.Delete) deleted++
  }

  return { added, deleted }
}
