import namedProps from "./named-props.mjs"

export default {
  rules: {
    "named-props": namedProps,
    "one-component": {
      meta: { type: "suggestion", schema: [], messages: { many: "One component per file. Move this component to its own UI file." } },
      create(context) {
        let count = 0
        const functions = new Set(["ArrowFunctionExpression", "FunctionExpression"])

        function record(node) {
          if (++count > 1) context.report({ node, messageId: "many" })
        }

        return {
          FunctionDeclaration(node) {
            if (/^[A-Z]/.test(node.id?.name ?? "")) record(node)
          },
          VariableDeclarator(node) {
            if (!/^[A-Z]/.test(node.id.name ?? "")) return
            const init = node.init

            if (!init) return

            const wrapped =
              init.type === "CallExpression" && ["memo", "forwardRef"].includes(init.callee.name ?? init.callee.property?.name)

            if (functions.has(init.type) || wrapped) record(node)
          },
          ExportDefaultDeclaration(node) {
            if (functions.has(node.declaration.type)) record(node)
          },
        }
      },
    },
  },
}
