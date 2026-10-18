import { vocabulary } from './domain-vocabulary.mjs';
import noInlineErrorCodes from './no-inline-error-codes.mjs';

const domainName =
  /(?:status|state|connection|kind|type|role|direction|action|tab|mode|delivery|provider|decision|language|theme|transport|confidence)$/i;

const platformCalls = new Set([
  'on',
  'once',
  'off',
  'emit',
  'addEventListener',
  'removeEventListener',
  't',
  'translate',
  'getQueryData',
  'setQueryData',
  'invalidateQueries',
]);

function name(node) {
  if (!node) {
    return '';
  }

  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
    return node.name;
  }

  if (node.type === 'MemberExpression') {
    return name(node.property);
  }

  if (node.type === 'Literal') {
    return String(node.value);
  }

  return '';
}

function domain(node) {
  return domainName.test(name(node));
}

function constantDeclaration(node) {
  let current = node.parent;

  while (current && !['Program', 'BlockStatement', 'ExpressionStatement'].includes(current.type)) {
    if (
      current.type === 'TSAsExpression' &&
      current.typeAnnotation?.type === 'TSTypeReference' &&
      current.typeAnnotation.typeName?.name === 'const'
    ) {
      const declaration = current.parent;

      return declaration?.type === 'VariableDeclarator' && /^[A-Z][A-Za-z0-9]*$/.test(name(declaration.id));
    }

    current = current.parent;
  }

  return false;
}

function exempt(node) {
  let current = node;

  while (current.parent) {
    const parent = current.parent;

    if (
      (parent.type === 'JSXAttribute' &&
        current.type === 'Literal' &&
        !/^[A-Z]/.test(name(parent.parent.name))) ||
      parent.type === 'ImportDeclaration' ||
      (parent.type === 'ExportNamedDeclaration' && parent.source === current)
    ) {
      return true;
    }

    if (parent.type === 'TSIndexedAccessType') {
      return true;
    }

    if (parent.type === 'Property' && parent.key === current && !parent.computed) {
      return true;
    }

    if (parent.type === 'CallExpression' && current === node && platformCalls.has(name(parent.callee))) {
      return true;
    }

    if (['Program', 'BlockStatement', 'ExpressionStatement', 'VariableDeclarator'].includes(parent.type)) {
      break;
    }

    current = parent;
  }

  return constantDeclaration(node);
}

function semantic(node) {
  let current = node;

  while (['ConditionalExpression', 'LogicalExpression', 'TSAsExpression'].includes(current.parent.type)) {
    current = current.parent;
  }

  const parent = current.parent;

  if (parent.type === 'TSLiteralType') {
    const container = parent.parent;

    return (
      container.type === 'TSUnionType' ||
      (container.type === 'TSTypeAnnotation' && container.parent.type === 'TSPropertySignature')
    );
  }

  if (parent.type === 'JSXAttribute') {
    return domain(parent.name);
  }

  if (parent.type === 'Property') {
    return parent.value === current && domain(parent.key);
  }

  if (parent.type === 'BinaryExpression') {
    return domain(parent.left) || domain(parent.right);
  }

  if (parent.type === 'AssignmentExpression') {
    return domain(parent.left);
  }

  if (parent.type === 'SwitchCase') {
    return domain(parent.parent.discriminant);
  }

  if (parent.type === 'VariableDeclarator') {
    return domain(parent.id);
  }

  if (parent.type === 'CallExpression') {
    return ['enum', 'literal'].includes(name(parent.callee)) || domain(parent.callee);
  }

  if (parent.type === 'ArrayExpression') {
    const outer = parent.parent;

    return (
      (outer.type === 'CallExpression' && ['enum', 'includes'].includes(name(outer.callee))) ||
      (outer.type === 'MemberExpression' &&
        ['includes', 'some', 'every', 'find', 'filter'].includes(name(outer.property)))
    );
  }

  return false;
}

export default {
  rules: {
    'no-inline-values': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          inline: 'Use a named domain constant and its derived type instead of inline value "{{value}}".',
        },
      },
      create(context) {
        const filename = context.filename.replaceAll('\\', '/');

        if (
          !/(?:apps\/(?:mini-app|daemon|server|chrome-extension|desktop)\/src|packages\/protocol\/src)\//.test(
            filename,
          ) ||
          /\.(?:test|spec|stories)\./.test(filename)
        ) {
          return {};
        }

        return {
          Literal(node) {
            if (
              typeof node.value === 'string' &&
              vocabulary.has(node.value) &&
              !exempt(node) &&
              semantic(node)
            ) {
              context.report({ node, messageId: 'inline', data: { value: node.value } });
            }
          },
        };
      },
    },
    'no-inline-error-codes': noInlineErrorCodes,
  },
};
