import { crossBoundaryImportPatterns, crossBoundaryImportSyntax } from "../../eslint/cross-boundary-imports.mjs"
import domain from "../../eslint/domain-values.mjs"
import js from "@eslint/js"
import ts from "typescript-eslint"
import globals from "globals"
import hooks from "eslint-plugin-react-hooks"
import refresh from "eslint-plugin-react-refresh"
import storybook from "eslint-plugin-storybook"
import { readabilityRules } from "./eslint/readability.mjs"
import components from "./eslint/one-component.mjs"
import { testIdRules, selectorRules, storyRules, numericValueRules } from "./eslint/rules.mjs"

export default ts.config(
  { ignores: ["node_modules/**", "storybook-static/**", ".storybook/public/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...storybook.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...readabilityRules,
      "max-lines": ["error", { max: 200 }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/packages/*/src/**"], message: "Import through @protocol, @protocol/private or @transport/*." },
            ...crossBoundaryImportPatterns,
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...crossBoundaryImportSyntax],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks, domain },
    rules: {
      "domain/no-inline-values": "error",
      "domain/no-inline-error-codes": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-syntax": ["error", ...testIdRules, ...numericValueRules, ...crossBoundaryImportSyntax],
    },
  },
  {
    files: ["src/**/*.tsx"],
    ignores: ["**/*.stories.tsx"],
    plugins: { "react-refresh": refresh, frontend: components },
    rules: { "react-refresh/only-export-components": "error", "frontend/one-component": "error", "frontend/named-props": "error" },
  },
  {
    files: ["src/**/*.stories.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...testIdRules,
        ...selectorRules,
        ...storyRules,
        ...numericValueRules,
        ...crossBoundaryImportSyntax,
      ],
    },
  },
  {
    files: [".storybook/**/*.ts", "tests/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...numericValueRules, ...crossBoundaryImportSyntax] },
  },
)
