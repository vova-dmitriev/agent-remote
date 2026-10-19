import { dirname, join, relative } from 'node:path';

const aliasPattern =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(@protocol(?:\/private)?|@transport\/[^'"]+)\2/g;

const protocolSource = 'packages/protocol/src';
const transportSource = 'packages/transport/src';

function emittedTarget(specifier) {
  if (specifier === '@protocol') {
    return `${protocolSource}/index.js`;
  }

  if (specifier === '@protocol/private') {
    return `${protocolSource}/errors/private-error-codes.js`;
  }

  const subpath = specifier.slice('@transport/'.length);

  return `${transportSource}/${subpath.endsWith('.js') ? subpath : `${subpath}.js`}`;
}

export function rewriteAliases(code, file, distRoot) {
  return code.replace(aliasPattern, (_match, prefix, quote, specifier) => {
    const path = relative(dirname(file), join(distRoot, emittedTarget(specifier)));

    return `${prefix}${quote}${path.startsWith('.') ? path : `./${path}`}${quote}`;
  });
}
