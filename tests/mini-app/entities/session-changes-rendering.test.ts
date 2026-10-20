import { expect, it } from 'vitest';
import { patchMarkdown, patchStats } from '../../../apps/mini-app/src/entities/session/lib/changes/patch.js';
import { highlightDiffLines } from '../../../apps/mini-app/src/entities/session/lib/changes/highlight-lines.js';

it('keeps untrusted patch text in a literal fenced code block', () => {
  const patch = "+```\n+<script>alert('synthetic')</script>\n-old\n+++ b/file.ts\n--- a/file.ts";

  expect(patchMarkdown('src/file.ts', patch)).toContain('````typescript\n' + patch);
  expect(patchStats(patch)).toEqual({ added: 2, deleted: 1 });
  expect(patchMarkdown('/unsafe.name<>', patch)).toContain('````plaintext\n');
});

it('preserves nested syntax tokens across diff lines without generating raw HTML', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [
          { type: 'text', value: '@@ -1 +1 @@\n-' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-keyword'] },
            children: [{ type: 'text', value: 'old\n+new' }],
          },
          { type: 'text', value: '\n' },
        ],
      },
    ],
  };

  highlightDiffLines()(tree);
  const code = tree.children[0]!;

  expect(JSON.stringify(code)).toContain('"data-diff-line":"add"');
  expect(JSON.stringify(code)).toContain('"data-diff-line":"delete"');
  expect(JSON.stringify(code)).toContain('hljs-keyword');
  expect(JSON.stringify(code)).not.toContain('"type":"raw"');
  expect(JSON.stringify(code)).not.toContain('"data-line":"2"');
});
