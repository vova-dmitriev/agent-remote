import domain from '../../eslint/domain-values.mjs';
import { createRequire } from 'node:module';
import { readabilityRules } from '../mini-app/eslint/readability.mjs';

// The workspace already installs the shared ESLint toolchain with the mini app.
const require = createRequire(new URL('../mini-app/package.json', import.meta.url));
const js = require('@eslint/js');
const ts = require('typescript-eslint');
const globals = require('globals');

export function nodeSourceConfig(files, ignores = []) {
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
      'no-nested-ternary': 'error',
      'max-statements-per-line': ['error', { max: 1 }],
      curly: ['error', 'all'],
    },
  });
}

export default nodeSourceConfig(['apps/daemon/src/**/*.ts']);
