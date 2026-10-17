export const PreviewSource = { Hover: "hover", Focus: "focus" } as const

export type PreviewSource = (typeof PreviewSource)[keyof typeof PreviewSource]
