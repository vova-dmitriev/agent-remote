import { LimitTone } from "@/entities/usage/config/values"

export const toneTextClass: Record<LimitTone, string> = {
  [LimitTone.Low]: "text-status-ready",
  [LimitTone.High]: "text-warning",
  [LimitTone.Exhausted]: "text-danger",
}

export const toneBarClass: Record<LimitTone, string> = {
  [LimitTone.Low]: "bg-status-ready",
  [LimitTone.High]: "bg-warning",
  [LimitTone.Exhausted]: "bg-danger",
}
