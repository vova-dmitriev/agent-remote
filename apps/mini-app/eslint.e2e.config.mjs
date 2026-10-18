import js from "@eslint/js"
import ts from "typescript-eslint"
import globals from "globals"
import { readabilityRules } from "./eslint/readability.mjs"
import { selectorRules } from "./eslint/rules.mjs"

export default ts.config(
  { ignores: ["tests/e2e/support/testid.ts"] },
  {
    files: ["tests/{e2e,extension-e2e}/**/*.ts"],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...readabilityRules,
      "max-lines": ["error", { max: 200 }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": ["error", ...selectorRules],
    },
  },
)
