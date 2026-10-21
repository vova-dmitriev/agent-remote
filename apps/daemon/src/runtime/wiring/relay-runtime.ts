import type { ServerFrame } from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import type { NativeProcesses } from '../../sessions/native-process.js';
import type { BridgeClient } from '../../desktop/bridge-client.js';
import { NativeRestartPoller } from '../native-restart-poller.js';
import { RelayFrameRouter } from '../relay-frame-router.js';
import { RelayLink, type RelayLinkDeps } from '../relay-link.js';
import { SourcePoller, type DesktopBindingEntry } from '../source-poller.js';
import type { SessionNamesPort, SessionRemovalPort } from '../../domain/ports/session-names.js';
import type { AnalyticsPort } from '../../analytics/collector.js';
import type { RulesPort } from '../../rules/service.js';

type RelayRuntimeDeps = RelayLinkDeps & {
  desktopBridge: BridgeClient;
  desktopBindings: Map<string, DesktopBindingEntry>;
  inputEnabled: boolean;
  nativeProcesses: NativeProcesses;
  names: SessionNamesPort;
  removal?: SessionRemovalPort;
  analytics?: AnalyticsPort | undefined;
  rules?: RulesPort | undefined;
};

/** Builds the relay link, frame router and pollers; the caller starts the pollers and connects the relay. */
export function createRelayRuntime(deps: RelayRuntimeDeps) {
  const { relay, monitor, adapters, readers, dispatcher, inputEnabled } = deps;
  const link = new RelayLink(deps);

  const router = new RelayFrameRouter({
    relay,
    profileRelay: link.profileRelay,
    readers,
    replay: link.replay,
    monitor,
    adapters,
    dispatcher,
    names: deps.names,
    removal: deps.removal,
    analytics: deps.analytics,
    rules: deps.rules,
  });

  relay.on(RuntimeEvent.Frame, (frame: ServerFrame) => void router.route(frame));

  const sourcePoller = new SourcePoller({
    monitor,
    adapters,
    store: deps.store,
    readers,
    desktopBridge: deps.desktopBridge,
    desktopBindings: deps.desktopBindings,
    inputEnabled,
    online: () => link.online,
    stopping: () => link.stopping,
    snapshot: link.snapshot,
    flush: link.flush,
    retryAttachmentExports: deps.retryAttachmentExports,
  });

  const nativePoller = new NativeRestartPoller({
    monitor,
    nativeProcesses: deps.nativeProcesses,
    inputEnabled,
    stopping: () => link.stopping,
  });

  return { link, sourcePoller, nativePoller };
}
