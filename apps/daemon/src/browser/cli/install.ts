import { lstat, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { BrowserKind, CodedError, ErrorCode } from '@protocol';
import { browserSettingsSchema } from '../../local/bootstrap/configuration.js';
import {
  canonicalPath,
  missing,
  safeEntry,
  secureDirectory,
  verifyCompanionRuntime,
} from '../../local/supervisor/runtime.js';
import { nativeHostManifestPath, registerNativeHost, unregisterNativeHost } from '../registration/index.js';
import {
  ownedContents,
  readSettings,
  requireSettings,
  wrapperContents,
  wrapperPath,
  writeOwned,
} from './settings.js';
import type { BrowserCliContext } from './types.js';

export function browserKind(value: string | undefined): BrowserKind {
  if (!Object.values(BrowserKind).includes(value as BrowserKind)) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  return value as BrowserKind;
}

export function extensionOrigin(id: string | undefined) {
  if (!id || !/^[a-p]{32}$/.test(id)) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  return `chrome-extension://${id}/`;
}

const descriptor = z.object({ runtime: browserSettingsSchema.shape.runtime });

async function packagedRuntime(directory: string) {
  canonicalPath(directory);
  await secureDirectory(directory);
  const path = join(directory, 'runtime-manifest.json');
  const stat = await lstat(path);

  safeEntry(stat);

  if (!stat.isFile() || stat.size > 65536) {
    throw new CodedError(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  const { runtime } = descriptor.parse(JSON.parse(await readFile(path, 'utf8')));

  const resource = (path: string) => {
    const target = resolve(directory, path);
    const rest = relative(directory, target);

    if (isAbsolute(path) || !rest || rest === '..' || rest.startsWith(`..${sep}`)) {
      throw new CodedError(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
    }

    return target;
  };

  const resolved = {
    ...runtime,
    nodePath: resource(runtime.nodePath),
    entryPath: resource(runtime.entryPath),
  };

  await verifyCompanionRuntime(resolved);

  return resolved;
}

function registration(context: BrowserCliContext, kind: BrowserKind, origins: string[]) {
  return {
    browserKind: kind,
    executablePath: wrapperPath(context.directory),
    allowedOrigins: origins,
    ...(context.homeDirectory ? { homeDirectory: context.homeDirectory } : {}),
    ...(context.platform ? { platform: context.platform } : {}),
  };
}

export async function installBrowser(
  context: BrowserCliContext,
  source: string,
  kind: BrowserKind,
  origin: string,
) {
  const runtime = await packagedRuntime(source);

  await secureDirectory(context.directory, true, true);
  const existing = await readSettings(context.directory);
  const settings = { origins: [origin], runtime };

  if (existing && JSON.stringify(existing) !== JSON.stringify(settings)) {
    throw new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH);
  }

  // Validate both product files before publishing either file.
  const script = wrapperContents(context.directory, settings);
  const previous = await ownedContents(wrapperPath(context.directory));

  if (previous !== undefined && previous !== script) {
    throw new CodedError(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  await writeOwned(wrapperPath(context.directory), script, 0o700);
  const options = registration(context, kind, settings.origins);

  await registerNativeHost(options);

  await writeOwned(
    join(context.directory, 'browser-settings.json'),
    JSON.stringify(settings, null, 2) + '\n',
    0o600,
  );
}

export async function uninstallBrowser(context: BrowserCliContext, kind: BrowserKind) {
  const settings = await requireSettings(context.directory);

  await unregisterNativeHost(registration(context, kind, settings.origins));

  for (const browser of Object.values(BrowserKind)) {
    try {
      await lstat(nativeHostManifestPath(registration(context, browser, settings.origins)));

      return;
    } catch (error) {
      if (!missing(error)) {
        throw error;
      }
    }
  }

  const path = wrapperPath(context.directory);

  if ((await ownedContents(path)) !== wrapperContents(context.directory, settings)) {
    throw new CodedError(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }

  await unlink(path);
  await unlink(join(context.directory, 'browser-settings.json'));
}
