import { expect, it } from 'vitest';
import { isLocalImagePath, localImagePaths } from '@protocol';

it('finds the local image paths a message names in code spans, link targets and running text', () => {
  const text = [
    'Screenshot: ~/Desktop/report-preview.png, and a crop at /tmp/shots/crop.JPG.',
    'With spaces: `/Users/owner/Library/Caches/Shot 2026-11-05 at 09.17.58.png`',
    'Linked: [preview](/Users/owner/out/chart.webp) and [diagram](<~/out/flow diagram.gif>)',
  ].join('\n');

  expect(localImagePaths(text).sort()).toEqual(
    [
      '/Users/owner/Library/Caches/Shot 2026-11-05 at 09.17.58.png',
      '/Users/owner/out/chart.webp',
      '/tmp/shots/crop.JPG',
      '~/Desktop/report-preview.png',
      '~/out/flow diagram.gif',
    ].sort(),
  );
});

it('leaves out URLs, relative paths, other files and the tails of longer words', () => {
  const text = [
    'https://example.com/assets/logo.png',
    'file name logo.png and ./out/chart.png',
    'see src/out/chart.png or ~user/x.png',
    '/var/log/system.log and `/etc/hosts`',
    'a //server/share/x.png path, /tmp/archive-png and /tmp/x.png.bak',
  ].join('\n');

  expect(localImagePaths(text)).toEqual([]);
  expect(isLocalImagePath('~/a b/c.png')).toBe(true);
  expect(isLocalImagePath('//server/x.png')).toBe(false);
  expect(isLocalImagePath('relative/x.png')).toBe(false);
});
