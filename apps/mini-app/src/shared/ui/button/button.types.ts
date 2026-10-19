import type { ComponentProps } from "react"
import type { VariantProps } from "class-variance-authority"
import type { TestAttributes } from "../types"
import type { buttonVariants } from "./button-variants"

export type ButtonProps = ComponentProps<"button"> &
  TestAttributes &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }
