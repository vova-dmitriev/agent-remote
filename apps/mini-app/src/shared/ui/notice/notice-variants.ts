import { cva } from "class-variance-authority"

const NoticeTone = { Info: "info", Error: "error" } as const

/** Inline notice block; inside the compact session shell it shrinks into a scrollable strip. */
export const noticeVariants = cva(
  "mb-[18px] rounded-[10px] px-[18px] py-[14px] text-[13px] session:my-[5px] session:max-h-[14dvh] session:flex-none session:overflow-y-auto session:px-[10px] session:py-[7px] session:text-[11px]",
  {
    variants: {
      tone: {
        [NoticeTone.Info]: "",
        [NoticeTone.Error]: "bg-error text-error-foreground",
      },
    },
    defaultVariants: { tone: NoticeTone.Info },
  },
)
