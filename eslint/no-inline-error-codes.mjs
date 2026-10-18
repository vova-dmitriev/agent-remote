const code = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

const productionPath =
  /(?:apps\/(?:mini-app|daemon|server|chrome-extension|desktop)\/src|packages\/[^/]+\/src)\//;

const maximumStaticDepth = 32;
const maximumStaticLength = 256;

const staticWrappers = [
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'ParenthesizedExpression',
];

function unwrapStaticExpression(node, depth) {
  let current = node;

  while (current && staticWrappers.includes(current.type) && depth <= maximumStaticDepth) {
    current = current.expression;
    depth += 1;
  }

  return current && !staticWrappers.includes(current.type) ? current : undefined;
}

function staticString(node, depth = 0) {
  if (!node || depth > maximumStaticDepth) {
    return undefined;
  }

  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value.length <= maximumStaticLength ? node.value : undefined;
  }

  if (staticWrappers.includes(node.type)) {
    return staticString(node.expression, depth + 1);
  }

  if (node.type === 'SpreadElement') {
    const spreadValue = unwrapStaticExpression(node.argument, depth + 1);

    if (spreadValue?.type === 'ArrayExpression') {
      return staticString(spreadValue.elements[0], depth + 1);
    }

    return undefined;
  }

  if (node.type === 'ArrayExpression' && node.elements.length === 1) {
    return staticString(node.elements[0], depth + 1);
  }

  if (node.type === 'TemplateLiteral') {
    let result = node.quasis[0]?.value.cooked ?? undefined;

    if (result === undefined || result.length > maximumStaticLength) {
      return undefined;
    }

    for (let index = 0; index < node.expressions.length; index += 1) {
      const insertion = staticString(node.expressions[index], depth + 1);
      const suffix = node.quasis[index + 1]?.value.cooked;

      if (insertion === undefined || suffix === undefined) {
        return undefined;
      }

      result += insertion + suffix;

      if (result.length > maximumStaticLength) {
        return undefined;
      }
    }

    return result;
  }

  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left, depth + 1);
    const right = staticString(node.right, depth + 1);

    if (left !== undefined && right !== undefined && left.length + right.length <= maximumStaticLength) {
      return left + right;
    }
  }

  return undefined;
}

function constructorName(node) {
  const expression = unwrapStaticExpression(node, 0);

  if (!expression) {
    return '';
  }

  if (expression.type === 'Identifier') {
    return expression.name;
  }

  if (expression.type !== 'MemberExpression') {
    return '';
  }

  const receiver = unwrapStaticExpression(expression.object, 0);

  if (receiver?.type !== 'Identifier' || receiver.name !== 'globalThis') {
    return '';
  }

  if (expression.computed) {
    return staticString(expression.property) ?? '';
  }

  return expression.property.type === 'Identifier' ? expression.property.name : '';
}

export default {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      inline: 'Use a named error-code constant instead of raw code "{{value}}".',
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!productionPath.test(filename) || /\.(?:test|spec|stories)\./.test(filename)) {
      return {};
    }

    return {
      NewExpression(node) {
        const constructor = constructorName(node.callee);
        const argument = node.arguments[0];
        const value = staticString(argument);

        if (!['Error', 'Fault'].includes(constructor) || typeof value !== 'string' || !code.test(value)) {
          return;
        }

        context.report({ node: argument, messageId: 'inline', data: { value } });
      },
    };
  },
};
