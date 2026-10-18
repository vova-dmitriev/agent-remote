import { readdirSync, readFileSync } from 'node:fs';

const roots = [
  'packages/protocol/src',
  'apps/daemon/src',
  'apps/server/src',
  'apps/mini-app/src',
  'apps/chrome-extension/src',
];

function declarations(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);

    if (entry.isDirectory()) {
      return declarations(path);
    }

    if (!entry.name.endsWith('.ts') || /\.(?:test|spec|stories)\./.test(entry.name)) {
      return [];
    }

    const source = readFileSync(path, 'utf8');

    return [
      ...source.matchAll(/(?:export\s+)?const\s+[A-Z][A-Za-z0-9]*\s*=\s*\{([\s\S]*?)\}\s*as const/g),
    ].flatMap((match) => [...match[1].matchAll(/:\s*['"]([^'"]+)['"]/g)].map((value) => value[1]));
  });
}

export const vocabulary = new Set(
  roots.flatMap((root) => declarations(new URL(`../${root}/`, import.meta.url))),
);
