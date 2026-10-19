/* eslint-disable no-restricted-syntax -- installer diagnostics are human-readable text, not wire error codes */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { BrowserKind, NATIVE_HOST_NAME } from '@protocol';
import type { NativeHostRegistration } from './types.js';
import { NativeHostPlatform } from './values.js';

const browserDirectories = {
  [BrowserKind.Chrome]: 'Google/Chrome',
  [BrowserKind.Chromium]: 'Chromium',
  [BrowserKind.ChromeForTesting]: 'Google/ChromeForTesting',
} as const;

export function nativeHostManifestPath(options: NativeHostRegistration): string {
  if ((options.platform ?? process.platform) !== NativeHostPlatform.MacOS) {
    throw new Error('Unsupported native host platform');
  }

  if (!Object.hasOwn(browserDirectories, options.browserKind)) {
    throw new Error('Unsupported native host browser');
  }

  const home = options.homeDirectory ?? homedir();

  if (!isAbsolute(home)) {
    throw new Error('Native host home must be absolute');
  }

  if (home !== resolve(home)) {
    throw new Error('Native host home must be canonical');
  }

  return join(
    home,
    'Library/Application Support',
    browserDirectories[options.browserKind],
    'NativeMessagingHosts',
    `${NATIVE_HOST_NAME}.json`,
  );
}
