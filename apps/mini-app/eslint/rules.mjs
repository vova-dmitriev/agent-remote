export const testIdRules = [
  { selector: "JSXAttribute[name.name='data-testid'] > Literal", message: "Use a test-ids.ts constant." },
  {
    selector: "JSXAttribute[name.name='data-testid'] > JSXExpressionContainer > :matches(Literal, TemplateLiteral)",
    message: "Use a test-ids.ts constant.",
  },
  {
    selector: "ImportDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
    message: "Use an absolute alias instead of traversing multiple directories.",
  },
]
export const selectorRules = [
  {
    selector:
      "CallExpression[callee.property.name=/^(get|find|query)(All)?By(Role|Text|Label|LabelText|Placeholder|PlaceholderText|Title|AltText|DisplayValue)$/]",
    message: "Use getByTestId with a test-ids.ts constant.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(get|find|query)(All)?ByTestId$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
    message: "Import a test-ids.ts constant.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(locator|querySelector|querySelectorAll|closest)$/]",
    message: "Use test-id locators and data-* filters.",
  },
]
export const storyRules = [
  {
    selector: "ImportDeclaration[source.value=/^(vitest|@vitest|expect|assert|node:assert|chai)(\\/|$)/]",
    message: "Assertion libraries are forbidden in stories.",
  },
  { selector: "CallExpression[callee.object.name=/^(assert|expect|should)$/]", message: "Assertions belong in test/spec files." },
  {
    selector: "ImportSpecifier[imported.name=/^(expect|assert|should)$/]",
    message: "Assertions belong in test/spec files, never stories.",
  },
  { selector: "CallExpression[callee.name=/^(expect|assert|should)$/]", message: "Story play functions perform interactions only." },
  {
    selector: "CallExpression[callee.property.name=/^(expect|assert|should)$/]",
    message: "Story play functions perform interactions only.",
  },
]
