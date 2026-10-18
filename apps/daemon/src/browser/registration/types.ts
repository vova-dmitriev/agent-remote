import type { BrowserKind } from '../../../../../packages/protocol/src/values/local-client.js';
import type { NativeHostInterface } from './values.js';

export interface NativeHostRegistration {
  browserKind: BrowserKind;
  executablePath: string;
  allowedOrigins: readonly string[];
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}
export interface NativeHostRegistrationResult {
  manifestPath: string;
}
export interface NativeHostManifest {
  name: string;
  description: string;
  path: string;
  type: NativeHostInterface;
  allowed_origins: string[];
}
