import { LimitTone } from "@/entities/usage/config/values"

export const toneBarClass: Record<LimitTone, string> = {
  [LimitTone.Low]: "bg-status-ready",
  [LimitTone.High]: "bg-warning",
  [LimitTone.Exhausted]: "bg-danger",
}
