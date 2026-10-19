import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../apps/mini-app', import.meta.url)));
const issues = [];
const source = join(root, 'src');
const layers = new Set(['app', 'pages', 'widgets', 'features', 'entities', 'shared']);
// Components style with Tailwind utilities; only the entry, the tokens and rendered-Markdown scope stay as CSS.
const stylesheets = new Set(['app/styles/globals.css', 'app/styles/tokens.css', 'app/styles/markdown.css']);

function visit(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const path = relative(source, directory);

  const files = entries.filter(
    (entry) => entry.isFile() && entry.name !== 'index.ts' && !entry.name.startsWith('.'),
  );

  if (/^(app|pages|widgets|features|entities|shared)(\/|$)/.test(path) && files.length > 6) {
    issues.push(`${path}: more than 6 files; colocate each component with its parts.`);
  }

  for (const entry of entries) {
    const target = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (directory === source && !layers.has(entry.name)) {
        issues.push(`${entry.name}: unsupported source-root directory.`);
      }

      visit(target);
      continue;
    }

    if (/\.s?css$/.test(entry.name) && !stylesheets.has(relative(source, target).split(sep).join('/'))) {
      issues.push(
        `${relative(source, target)}: stylesheet outside the allowlist; use Tailwind utilities and theme tokens.`,
      );
    }

    if (!/\.(ts|tsx|css|mjs)$/.test(entry.name)) {
      continue;
    }

    const content = readFileSync(target, 'utf8');
    const lines = content.split('\n').length - Number(content.endsWith('\n'));

    if (lines > 200) {
      issues.push(`${relative(source, target)}: ${lines} exceeds 200 lines.`);
    }

    const palette =
      /\b(?:bg|text|border|ring|outline|fill|stroke|decoration|placeholder|shadow|accent|caret|from|via|to|divide)(?:-[a-z]+)?-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;

    const literalFunction =
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[-+\d.]|\bcolor\(\s*(?:srgb|display-p3|rec2020|xyz)\s+[-+\d.]/i;

    const namedColor =
      /\b(?:color|background(?:-color)?|border-color|fill|stroke)\s*:\s*(?!(?:transparent|currentColor|inherit|initial|unset|revert|none)\b)[a-z]+\s*(?:;|!|})/i;

    const literalColor =
      /#[a-f\d]{3,8}\b/i.test(content) ||
      palette.test(content) ||
      literalFunction.test(content) ||
      namedColor.test(content);

    if (literalColor && !target.endsWith('/app/styles/tokens.css')) {
      issues.push(`${relative(source, target)}: use theme tokens instead of color literals.`);
    }
  }
}

visit(source);

if (issues.length) {
  process.stderr.write(issues.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Frontend structure clean: layers, file sizes, directory sizes, theme tokens, stylesheet allowlist.\n',
  );
}
