import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNode } from '../scripts/build/node.mjs';
import { rewriteAliases } from '../scripts/build/rewrite-aliases.mjs';

const dist = '/repo/dist';

describe('rewriteAliases', () => {
  it('rewrites @protocol to the emitted index', () => {
    expect(
      rewriteAliases(
        "import { ErrorCode } from '@protocol';",
        '/repo/dist/apps/server/src/auth/security.js',
        dist,
      ),
    ).toBe("import { ErrorCode } from '../../../../packages/protocol/src/index.js';");
  });

  it('rewrites @protocol/private and @transport subpaths', () => {
    const out = rewriteAliases(
      "export { X } from '@protocol/private';\nimport { y } from '@transport/native/fragments.js';",
      '/repo/dist/apps/daemon/src/main.js',
      dist,
    );

    expect(out).toContain("'../../../packages/protocol/src/errors/private-error-codes.js'");
    expect(out).toContain("'../../../packages/transport/src/native/fragments.js'");
  });

  it('rewrites dynamic and type-position imports', () => {
    expect(rewriteAliases("const m = await import('@protocol');", '/repo/dist/x.js', dist)).toBe(
      "const m = await import('./packages/protocol/src/index.js');",
    );

    expect(rewriteAliases("q: import('@protocol').UserInputQuestion[]", '/repo/dist/x.d.ts', dist)).toContain(
      "import('./packages/protocol/src/index.js')",
    );
  });

  it('leaves other specifiers alone', () => {
    const src = "import x from '@nestjs/core'; import y from './protocol.js';";

    expect(rewriteAliases(src, '/repo/dist/x.js', dist)).toBe(src);
  });
});

describe('buildNode', () => {
  it('emits dist that plain Node can import', { timeout: 180_000 }, async () => {
    await buildNode();

    const leftovers = ['dist/apps', 'dist/packages'].flatMap((directory) =>
      readdirSync(directory, { recursive: true, encoding: 'utf8' })
        .filter((entry) => /\.(?:js|d\.ts)$/.test(entry) && !entry.split(sep).includes('mini-app'))
        .filter((entry) =>
          /['"]@(?:protocol|transport\/)/.test(readFileSync(join(directory, entry), 'utf8')),
        ),
    );

    expect(leftovers).toEqual([]);

    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "await import('./dist/apps/daemon/src/setup-cli.js'); await import('./dist/apps/server/src/relay.js')",
      ],
      { stdio: 'pipe' },
    );
  });
});
