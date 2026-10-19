import domain from '../../eslint/domain-values.mjs';
import { createRequire } from 'node:module';
import { readabilityRules } from '../mini-app/eslint/readability.mjs';
import { numericValueRules } from '../mini-app/eslint/rules.mjs';

// The workspace already installs the shared ESLint toolchain with the mini app.
const require = createRequire(new URL('../mini-app/package.json', import.meta.url));
const js = require('@eslint/js');
const ts = require('typescript-eslint');
const globals = require('globals');

export const codedErrorRules = [
  {
    selector: [
      "ThrowStatement > NewExpression[callee.name='Error'][arguments.length>0]",
      "CallExpression > NewExpression[callee.name='Error'][arguments.length>0]",
      "ReturnStatement > NewExpression[callee.name='Error'][arguments.length>0]",
      "ArrowFunctionExpression > NewExpression[callee.name='Error'][arguments.length>0]",
    ].join(', '),
    message: 'Construct CodedError(code) so callers can use errorCode(error).',
  },
  {
    selector:
      'BinaryExpression[operator=/^[!=]==?$/]:matches([left.property.name="message"], [right.property.name="message"])',
    message: 'Compare errorCode(error) / hasErrorCode(error, code) instead of error.message.',
  },
];

export function nodeSourceConfig(files, ignores = [], restrictedSyntax = []) {
  return ts.config({
    files,
    ignores,
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: { globals: globals.node },
    plugins: { domain },
    rules: {
      'domain/no-inline-values': 'error',
      'domain/no-inline-error-codes': 'error',
      ...readabilityRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/*/src/**'],
              message: 'Import through @protocol, @protocol/private or @transport/*.',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...numericValueRules, ...restrictedSyntax],
      'no-nested-ternary': 'error',
      'max-statements-per-line': ['error', { max: 1 }],
      curly: ['error', 'all'],
    },
  });
}

export default nodeSourceConfig(['apps/daemon/src/**/*.ts'], [], codedErrorRules);
