import { PatchLineKind } from "./line-kind"

const lineClass =
  "inline-block min-w-full px-[0.6rem] before:inline-block before:min-w-[2.5em] before:pr-[0.65em] before:text-muted-foreground before:select-none before:content-[attr(data-line)]"

/** Tailwind classes for generated patch-line spans; rendered Markdown has no JSX to carry them. */
export const patchLineClass: Record<PatchLineKind, string> = {
  [PatchLineKind.Add]: `${lineClass} bg-status-ready/15`,
  [PatchLineKind.Delete]: `${lineClass} bg-destructive/13`,
  [PatchLineKind.Context]: lineClass,
  [PatchLineKind.Hunk]: `${lineClass} bg-primary/8 text-muted-foreground`,
}
