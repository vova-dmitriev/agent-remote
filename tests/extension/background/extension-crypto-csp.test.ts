import { expect, it } from 'vitest';
import { extensionManifestFor, serverOrigin } from '@extension/config/manifest.js';

const extensionManifest = extensionManifestFor();

it('allows only bundled WebAssembly encryption while keeping JavaScript evaluators and remote scripts blocked', () => {
  const csp = extensionManifest.content_security_policy.extension_pages;

  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toMatch(/https?:|\*/);
  expect(extensionManifest.permissions).toEqual(['sidePanel', 'nativeMessaging', 'storage']);
});

it('lets a linked build connect to its one HTTPS server and nothing else', () => {
  const csp = extensionManifestFor(serverOrigin('https://relay.example'))!.content_security_policy
    .extension_pages;

  expect(csp).toContain("connect-src 'self' https://relay.example wss://relay.example;");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(serverOrigin(undefined)).toBeUndefined();
  expect(() => serverOrigin('http://relay.example')).toThrow();
  expect(() => serverOrigin('https://relay.example/path')).toThrow();
});
