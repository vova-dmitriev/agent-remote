import { FragmentReader } from '@transport/native/fragments.js';
import {
  LocalKind,
  LocalOperation,
  CommandStatus,
  ErrorCode,
  type LocalAction,
  type CommandResult,
} from '@protocol';
import { ViewerRegistry } from '@extension/background/registry.js';
import { workerFixture, workerPort } from '../background/extension-worker.fixture.js';
import { snapshotFrame } from './extension-client.fixture.js';

export function reconnectFixture() {
  const f = workerFixture();
  const registry = new ViewerRegistry(f.api);
  const hosts: ReturnType<typeof workerPort>[] = [];
  const hellos: Record<string, unknown>[] = [];
  const actions: LocalAction[] = [];
  const receipts = new Map<string, CommandResult>();
  let available = true;
  let dropSend = false;
  let revoked = false;
  let helloFailure: string | undefined;

  f.api.runtime.connect = () => {
    const page = workerPort();
    const worker = workerPort();

    page.port.postMessage = (value) => worker.message(value);
    worker.port.postMessage = (value) => page.message(value);
    page.port.disconnect = () => worker.close();
    worker.port.disconnect = () => page.close();
    registry.attach(worker.port);

    return page.port;
  };

  f.api.runtime.connectNative = () => {
    const host = workerPort();
    const reader = new FragmentReader();
    const lease = 'lease-' + hosts.length;

    hosts.push(host);

    host.port.postMessage = (piece) => {
      const value = reader.accept(piece) as
        { kind: string; requestId: string; action?: LocalAction } | undefined;

      if (!value) {
        return;
      }

      const result = (data: unknown) =>
        host.native({ kind: LocalKind.Result, requestId: value.requestId, ok: true, data });

      if (!available) {
        queueMicrotask(() => host.close());

        return;
      }

      if (value.kind === LocalKind.Hello) {
        hellos.push(value);

        if (helloFailure) {
          host.native({ kind: LocalKind.Result, requestId: value.requestId, ok: false, code: helloFailure });

          return;
        }

        result({ lease, handle: 'stable-handle', ownerId: 'owner', deviceId: 'device' });

        return;
      }

      const action = value.action!;

      actions.push(action);

      if (revoked) {
        host.native({
          kind: LocalKind.Result,
          requestId: value.requestId,
          ok: false,
          code: ErrorCode.LOCAL_GRANT_REVOKED,
        });

        return;
      }

      switch (action.operation) {
        case LocalOperation.Select:
          result(null);
          host.native({ kind: LocalKind.Event, lease, frame: snapshotFrame() });
          break;
        case LocalOperation.History:
          result({ events: [], before: null, after: null });
          break;
        case LocalOperation.ReadingGet:
          result({ revision: 0, position: null });
          break;

        case LocalOperation.Send: {
          const receipt = { commandId: action.command.commandId, status: CommandStatus.Dispatched };

          receipts.set(action.command.commandId, receipt);

          if (!dropSend) {
            result(receipt);
          }

          break;
        }

        case LocalOperation.Receipt:
          result(receipts.get(action.commandId));
          break;
        case LocalOperation.Devices:
          result([{ id: 'device', last_seen_at: new Date().toISOString() }]);
          break;
        default:
          throw new Error(ErrorCode.INVALID_REQUEST);
      }
    };

    return host.port;
  };

  return {
    ...f,
    hosts,
    hellos,
    actions,
    available: (value: boolean) => {
      available = value;
    },
    denyHello: (code: string) => {
      helloFailure = code;
    },
    dropSend: () => {
      dropSend = true;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
