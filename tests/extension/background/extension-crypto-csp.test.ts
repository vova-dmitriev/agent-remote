import { expect, it } from 'vitest';
import { extensionManifest } from '../../../apps/chrome-extension/src/config/manifest.js';

it('allows only bundled WebAssembly encryption while keeping JavaScript evaluators and remote scripts blocked', () => {
  const csp = extensionManifest.content_security_policy.extension_pages;

  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toMatch(/https?:|\*/);
  expect(extensionManifest.permissions).toEqual(['sidePanel', 'nativeMessaging', 'storage']);
});
