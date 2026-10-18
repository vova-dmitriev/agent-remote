import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const expectedPermissions = ['nativeMessaging', 'sidePanel', 'storage'];

const manifestFields = new Set(
  'manifest_version name version description minimum_chrome_version permissions incognito action side_panel background content_security_policy key'.split(
    ' ',
  ),
);

const expectedCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";

const assetExtensions = new Set('.js .css .svg .png .jpg .jpeg .webp .woff .woff2 .ico'.split(' '));

const forbiddenContent = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{16,}/,
  /\b(?:deviceToken|hookSecret|nativeToken|accessToken)\s*[=:]\s*["'][A-Za-z0-9_-]{16,}/i,
  /(?:__EXTENSION_TEST_BRIDGE__|__PLAYWRIGHT|__VITE_IS_MODERN__|@vite\/client|react-refresh)/,
  /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/,
];

function reject(category) {
  throw new Error(`Extension artifact rejected: ${category}`);
}

function contained(root, path) {
  const child = relative(root, path);

  return !!child && !child.startsWith('..') && !isAbsolute(child);
}

function resource(root, owner, reference) {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(reference) || /[?#]/.test(reference)) {
    reject('non-local resource');
  }

  const path = resolve(dirname(owner), reference);

  if (
    !contained(root, path) ||
    !existsSync(path) ||
    !lstatSync(path).isFile() ||
    !contained(root, realpathSync(path))
  ) {
    reject('missing or unsafe resource');
  }

  return path;
}

function inspectText(root, path, text) {
  if (forbiddenContent.some((pattern) => pattern.test(text))) {
    reject('sensitive or development content');
  }

  if (extname(path) === '.js') {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

    const visit = (node) => {
      if (ts.isIdentifier(node) && ['eval', 'Function', 'importScripts'].includes(node.text)) {
        reject('dynamic executable code');
      }

      let target;

      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        target = node.moduleSpecifier;
      } else if (
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          ['Worker', 'SharedWorker'].includes(node.expression.text))
      ) {
        target = node.arguments?.[0];
      }

      if (target) {
        if (!ts.isStringLiteral(target) && !ts.isNoSubstitutionTemplateLiteral(target)) {
          reject('non-literal executable import');
        }

        resource(root, path, target.text);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  if (extname(path) === '.css' && /(?:@import|url\s*\()\s*["']?\s*(?:https?:|\/\/)/i.test(text)) {
    reject('remote stylesheet resource');
  }

  if (extname(path) === '.html') {
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1]);

      if (!source || match[2].trim() || !/\btype\s*=\s*["']module["']/i.test(match[1])) {
        reject('inline or non-module script');
      }

      if (extname(resource(root, path, source[1])) !== '.js') {
        reject('non-JavaScript script');
      }
    }

    if (/<(?:iframe|object|embed|base)\b|\bon\w+\s*=|javascript:/i.test(text)) {
      reject('unsafe HTML');
    }

    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      resource(root, path, match[1]);
    }
  }
}

export function verifyArtifact(directory) {
  try {
    const root = realpathSync(resolve(directory));
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

    if (
      Object.keys(manifest).some((field) => !manifestFields.has(field)) ||
      manifest.manifest_version !== 3 ||
      manifest.minimum_chrome_version !== '116' ||
      manifest.incognito !== 'not_allowed' ||
      JSON.stringify(manifest.permissions?.toSorted()) !== JSON.stringify(expectedPermissions) ||
      JSON.stringify(manifest.background) !==
        JSON.stringify({ service_worker: 'background.js', type: 'module' }) ||
      JSON.stringify(manifest.side_panel) !== JSON.stringify({ default_path: 'extension.html' }) ||
      JSON.stringify(manifest.action) !== JSON.stringify({ default_title: 'Agent Remote' }) ||
      JSON.stringify(manifest.content_security_policy) !== JSON.stringify({ extension_pages: expectedCsp })
    ) {
      reject('manifest policy');
    }

    resource(root, resolve(root, 'manifest.json'), 'background.js');
    resource(root, resolve(root, 'manifest.json'), 'extension.html');

    const inspect = (directoryPath) => {
      for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        const path = resolve(directoryPath, entry.name);

        if (entry.isSymbolicLink()) {
          reject('symlink');
        }

        if (entry.isDirectory()) {
          if (relative(root, path) !== 'assets') {
            reject('unexpected directory');
          }

          inspect(path);
          continue;
        }

        const name = relative(root, path);

        if (
          !['manifest.json', 'extension.html', 'background.js'].includes(name) &&
          !(name.startsWith('assets/') && assetExtensions.has(extname(path)))
        ) {
          reject('unexpected file');
        }

        if (['.js', '.css', '.html', '.json', '.svg'].includes(extname(path))) {
          inspectText(root, path, readFileSync(path, 'utf8'));
        }
      }
    };

    inspect(root);

    return { filesVerified: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Extension artifact rejected:')) {
      throw error;
    }

    reject('unreadable artifact');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyArtifact(process.argv[2] ?? 'dist/chrome-extension');
    console.log('Extension artifact verified');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
