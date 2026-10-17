// Match the reference project's enforced separation of logical code blocks.
export const readabilityRules = {
  "padding-line-between-statements": [
    "error",
    { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
    { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
    { blankLine: "always", prev: "*", next: ["multiline-expression", "multiline-const", "multiline-let", "block-like", "return"] },
    { blankLine: "always", prev: ["multiline-expression", "multiline-const", "multiline-let", "block-like"], next: "*" },
    { blankLine: "any", prev: "directive", next: "*" },
    { blankLine: "always", prev: "import", next: "*" },
    { blankLine: "any", prev: "import", next: "import" },
  ],
}
