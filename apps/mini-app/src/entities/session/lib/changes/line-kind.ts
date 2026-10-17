export const PatchLineKind = { Add: "add", Delete: "delete", Context: "context", Hunk: "hunk" } as const

export type PatchLineKind = (typeof PatchLineKind)[keyof typeof PatchLineKind]
