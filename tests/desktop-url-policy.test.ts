import { describe, expect, it } from 'vitest';
import { DESKTOP_ASSET_URL, isTrustedDesktopUrl } from '../apps/desktop/src/main/config/links.js';

describe('trusted desktop origin', () => {
  it('accepts the fixed asset URL with any in-app fragment', () => {
    for (const url of [
      DESKTOP_ASSET_URL,
      `${DESKTOP_ASSET_URL}#`,
      `${DESKTOP_ASSET_URL}#/`,
      `${DESKTOP_ASSET_URL}#/sessions/synthetic-session`,
      `${DESKTOP_ASSET_URL}#/sessions/synthetic%2Fsession/agents/agent-1`,
      `${DESKTOP_ASSET_URL}#?query=in-fragment`,
    ]) {
      expect(isTrustedDesktopUrl(url), url).toBe(true);
    }
  });

  it('refuses every other document, including normalisation and encoding tricks', () => {
    for (const url of [
      'agent-remote://@bundle/desktop.html',
      'agent-remote://bundle:/desktop.html',
      'agent-remote://bundle:0443/desktop.html',
      'agent-remote:\\\\bundle\\desktop.html',
      'agent-remote://bundle/desktop.html/..',
      'agent-remote://bundle/desktop.html/../desktop.html',
      'agent-remote://bundle/./desktop.html',
      'agent-remote://bundle/other/../desktop.html#/',
      'agent-remote://bundle/desktop%2Ehtml',
      'agent-remote://bundle/%64esktop.html',
      'agent-remote://bundle/desktop.html%23/sessions/x',
      'agent-remote://bundle/desktop.html/',
      'agent-remote://bundle/index.html',
      'agent-remote://bundle/desktop.html?next=/',
      'agent-remote://bundle/desktop.html?#/',
      'agent-remote://BUNDLE/desktop.html',
      'agent-remote://bundle.evil/desktop.html',
      'agent-remote://evil/desktop.html#agent-remote://bundle/desktop.html',
      'agent-remote://user:secret@bundle/desktop.html',
      'agent-remote://user@bundle/desktop.html#/',
      'agent-remote://:secret@bundle/desktop.html',
      'https://bundle/desktop.html',
      'file:///bundle/desktop.html',
      ' agent-remote://bundle/desktop.html',
      'agent-remote://bundle/desktop.html\n#/',
      '',
    ]) {
      expect(isTrustedDesktopUrl(url), url).toBe(false);
    }
  });
});
