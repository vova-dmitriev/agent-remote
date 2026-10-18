import { describe, expect, it } from 'vitest';
import { DESKTOP_ASSET_URL, isTrustedDesktopUrl } from '../apps/desktop/src/main/config/links.js';

describe('trusted desktop origin', () => {
  it('accepts only the exact fixed asset URL', () => {
    expect(isTrustedDesktopUrl(DESKTOP_ASSET_URL)).toBe(true);

    for (const url of [
      'agent-remote://@bundle/desktop.html',
      'agent-remote://bundle:/desktop.html',
      'agent-remote://bundle:0443/desktop.html',
      'agent-remote:\\\\bundle\\desktop.html',
    ]) {
      expect(isTrustedDesktopUrl(url), url).toBe(false);
    }
  });
});
