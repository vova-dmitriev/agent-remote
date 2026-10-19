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

const httpStatusLiteral = "Literal[raw=/^[1-5]\\d\\d$/]"
const statusNames = "/^(status|statusCode|error_code)$/"

export const numericValueRules = [
  `NewExpression[callee.name='Fault'] ${httpStatusLiteral}`,
  `CallExpression[callee.property.name=/^(status|sendStatus)$/] ${httpStatusLiteral}`,
  `AssignmentExpression[left.property.name=/^(status|statusCode)$/] ${httpStatusLiteral}`,
  `BinaryExpression[operator=/^([!=]==?|[<>]=?)$/]:has(MemberExpression[property.name=${statusNames}]) > ${httpStatusLiteral}`,
  `Property[key.name=/^(status|statusCode)$/] ${httpStatusLiteral}`,
  "CallExpression[callee.property.name='close'] > Literal[raw=/^\\d{4}$/]",
  "BinaryExpression:has(MemberExpression[property.name='code']) > Literal[raw=/^4\\d{3}$/]",
].map((selector) => ({ selector, message: "Use HttpStatus / SocketCloseCode / SocketCloseReason from @protocol." }))
