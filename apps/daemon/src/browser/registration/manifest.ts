import { isAbsolute, resolve } from 'node:path';
import { NATIVE_HOST_NAME } from '@protocol';
import type { NativeHostManifest, NativeHostRegistration } from './types.js';
import { NATIVE_HOST_DESCRIPTION, NativeHostInterface } from './values.js';

export function createNativeHostManifest(options: NativeHostRegistration): NativeHostManifest {
  if (!isAbsolute(options.executablePath) || options.executablePath.includes('\0')) {
    // eslint-disable-next-line no-restricted-syntax -- installer diagnostic text
    throw new Error('Native host executable path must be absolute');
  }

  if (options.executablePath !== resolve(options.executablePath)) {
    // eslint-disable-next-line no-restricted-syntax -- installer diagnostic text
    throw new Error('Native host executable path must be canonical');
  }

  const origins = options.allowedOrigins;

  if (
    !Array.isArray(origins) ||
    origins.length === 0 ||
    origins.length > 32 ||
    new Set(origins).size !== origins.length ||
    origins.some((origin) => typeof origin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin))
  ) {
    // eslint-disable-next-line no-restricted-syntax -- installer diagnostic text
    throw new Error('Native host requires exact unique extension origins');
  }

  return {
    name: NATIVE_HOST_NAME,
    description: NATIVE_HOST_DESCRIPTION,
    path: options.executablePath,
    type: NativeHostInterface.Stdio,
    allowed_origins: [...origins].sort(),
  };
}

export function isMatchingManifest(value: unknown, expected: NativeHostManifest): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Object.keys(record).length === 5 &&
    record.name === expected.name &&
    record.description === expected.description &&
    record.path === expected.path &&
    record.type === expected.type &&
    Array.isArray(record.allowed_origins) &&
    record.allowed_origins.length === expected.allowed_origins.length &&
    [...record.allowed_origins].sort().every((origin, index) => origin === expected.allowed_origins[index])
  );
}
