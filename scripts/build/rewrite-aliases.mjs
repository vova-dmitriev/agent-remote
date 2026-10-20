import { dirname, join, relative } from 'node:path';

// Exact aliases map to one emitted file; prefix aliases (`@name/*`) map to an emitted source directory.
const exactAliases = {
  '@protocol': 'packages/protocol/src/index.js',
  '@protocol/private': 'packages/protocol/src/errors/private-error-codes.js',
};

const prefixAliases = {
  '@transport': 'packages/transport/src',
  '@daemon': 'apps/daemon/src',
  '@server': 'apps/server/src',
  '@desktop': 'apps/desktop/src',
  '@extension': 'apps/chrome-extension/src',
};

const escape = (alias) => alias.replace(/[/]/g, '\\/');

const exactPattern = Object.keys(exactAliases)
  .sort((left, right) => right.length - left.length)
  .map(escape)
  .join('|');

const prefixPattern = Object.keys(prefixAliases).map(escape).join('|');

const aliasPattern = new RegExp(
  `(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)(['"])(${exactPattern}|(?:${prefixPattern})\\/[^'"]+)\\2`,
  'g',
);

function emittedTarget(specifier) {
  if (specifier in exactAliases) {
    return exactAliases[specifier];
  }

  const separator = specifier.indexOf('/');
  const subpath = specifier.slice(separator + 1);

  return `${prefixAliases[specifier.slice(0, separator)]}/${subpath.endsWith('.js') ? subpath : `${subpath}.js`}`;
}

export function rewriteAliases(code, file, distRoot) {
  return code.replace(aliasPattern, (_match, prefix, quote, specifier) => {
    const path = relative(dirname(file), join(distRoot, emittedTarget(specifier)));

    return `${prefix}${quote}${path.startsWith('.') ? path : `./${path}`}${quote}`;
  });
}
