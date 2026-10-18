import { ErrorCode } from '../../../../../packages/protocol/src/index.js';
import { stateDirectory } from '../../config.js';
import { BrowserAction } from '../../domain/browser.js';
import { browserKind, extensionOrigin, installBrowser, uninstallBrowser } from './install.js';
import { browserHost, startLocal } from './host.js';
import { browserGrants } from './grants.js';
import type { BrowserCliOptions } from './types.js';

export async function runBrowserCli(args: readonly string[], options: BrowserCliOptions = {}): Promise<void> {
  const [action, ...parameters] = args;

  const context = {
    ...options,
    directory: options.directory ?? stateDirectory(),
    output: options.output ?? process.stdout,
  };

  if (action === BrowserAction.Install && parameters.length === 3) {
    await installBrowser(context, parameters[0]!, browserKind(parameters[1]), extensionOrigin(parameters[2]));

    return;
  }

  if (action === BrowserAction.Uninstall && parameters.length === 1) {
    await uninstallBrowser(context, browserKind(parameters[0]));

    return;
  }

  if (action === BrowserAction.Host && parameters.length === 1) {
    await browserHost(context, parameters[0]!);

    return;
  }

  if (action === BrowserAction.StartLocal && parameters.length === 0) {
    await startLocal(context);

    return;
  }

  if (
    (action === BrowserAction.AuthorizeDesktop && parameters.length === 1) ||
    (action === BrowserAction.Authorize && (parameters.length === 0 || parameters.length === 2)) ||
    (action === BrowserAction.Pending && parameters.length === 0) ||
    (action === BrowserAction.Revoke && parameters.length === 1)
  ) {
    await browserGrants(context, action, parameters[0], parameters[1]);

    return;
  }

  throw new Error(ErrorCode.INVALID_REQUEST);
}

export type { BrowserCliOptions, BrowserCliDependencies } from './types.js';
