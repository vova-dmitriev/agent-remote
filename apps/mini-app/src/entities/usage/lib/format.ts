import type { Language, UsageTokens } from "@protocol"

/** Every token a request was billed for: fresh input, output and both cache directions. */
export const totalTokens = (tokens: UsageTokens) => tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite

/** "1.2M", "34K", "980". */
export const formatTokens = (count: number, language: Language) =>
  new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(count)

/** API-equivalent dollars, or null when no model in the row has a known price. */
export const formatCost = (cost: number | null, language: Language) =>
  cost === null
    ? null
    : new Intl.NumberFormat(language, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: cost < 10 ? 2 : 0,
      }).format(cost)
