export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { named: "Move component props into a named interface or type in a separate type file." },
  },
  create(context) {
    function check(node, name) {
      if (!/^[A-Z]/.test(name ?? "")) return
      const annotation = node.params[0]?.typeAnnotation?.typeAnnotation

      if (annotation?.type === "TSTypeLiteral" && annotation.members.length > 1) context.report({ node: annotation, messageId: "named" })
    }

    return {
      FunctionDeclaration(node) {
        check(node, node.id?.name)
      },
      VariableDeclarator(node) {
        const value = node.init

        const wrapped =
          value?.type === "CallExpression" && ["memo", "forwardRef"].includes(value.callee.name ?? value.callee.property?.name)

        const component = wrapped ? value.arguments[0] : value

        if (["ArrowFunctionExpression", "FunctionExpression"].includes(component?.type)) check(component, node.id.name)
      },
    }
  },
}
