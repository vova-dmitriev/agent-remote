import { expect, it, vi, describe } from 'vitest';
import { ErrorCode, HistoryPageDirection, LocalKind, LocalOperation } from '@protocol';
import { broker, snapshotFrame } from './extension-client.fixture.js';
import { ExtensionApplicationClient } from '../apps/chrome-extension/src/client/application-client.js';

describe('extension application operations', () => {
  it('reloads bookmark revision conflicts without overwriting the authoritative position', async () => {
    const viewer = broker();

    await viewer.ready();

    const client = new ExtensionApplicationClient(viewer.connection, {
      onFrame: () => {},
      onConnection: () => {},
    });

    const read = client.getReadingPosition('session');

    viewer.reply({
      kind: LocalKind.Result,
      requestId: viewer.sent.at(-1)!.requestId,
      ok: true,
      data: { revision: 3, position: null },
    });

    await read;
    const save = client.saveReadingPosition('session', { messageId: 'm1', offset: 0, updatedAt: 100 });

    expect(viewer.sent.at(-1)!.action).toMatchObject({ operation: LocalOperation.ReadingSave, revision: 3 });

    viewer.reply({
      kind: LocalKind.Result,
      requestId: viewer.sent.at(-1)!.requestId,
      ok: false,
      code: ErrorCode.LOCAL_REVISION_CONFLICT,
    });

    await vi.waitFor(() =>
      expect(viewer.sent.at(-1)!.action).toMatchObject({ operation: LocalOperation.ReadingGet }),
    );

    viewer.reply({
      kind: LocalKind.Result,
      requestId: viewer.sent.at(-1)!.requestId,
      ok: true,
      data: { revision: 4, position: { messageId: 'm2', offset: 8, updatedAt: 200 } },
    });

    await expect(save).resolves.toEqual({ position: { messageId: 'm2', offset: 8, updatedAt: 200 } });

    expect(
      viewer.sent.filter(
        (message) => (message.action as { operation?: string })?.operation === LocalOperation.ReadingSave,
      ),
    ).toHaveLength(1);

    const requests = viewer.sent.length;
    const stale = client.saveReadingPosition('session', { messageId: 'm1', offset: 0, updatedAt: 100 });

    expect(viewer.sent).toHaveLength(requests);
    await expect(stale).resolves.toEqual({ position: { messageId: 'm2', offset: 8, updatedAt: 200 } });
    client.close();
  });
});

it('fences old history responses when a viewer changes selection', async () => {
  const viewer = broker();

  await viewer.ready();

  const client = new ExtensionApplicationClient(viewer.connection, {
    onFrame: () => {},
    onConnection: () => {},
  });

  await client.start();
  viewer.reply({ kind: LocalKind.Result, requestId: viewer.sent.at(-1)!.requestId, ok: true, data: null });
  viewer.reply({ kind: LocalKind.Event, lease: 'lease-1', frame: snapshotFrame() });
  client.selectTarget('device', 'a');
  viewer.reply({ kind: LocalKind.Result, requestId: viewer.sent.at(-1)!.requestId, ok: true, data: null });
  const oldHistory = client.history('a', true);
  const oldId = viewer.sent.at(-1)!.requestId;

  expect(viewer.sent.at(-1)!.action).toMatchObject({
    operation: LocalOperation.History,
    sessionId: 'a',
    generation: 'generation-a',
  });

  client.selectTarget('device', 'b');
  viewer.reply({ kind: LocalKind.Result, requestId: viewer.sent.at(-1)!.requestId, ok: true, data: null });

  viewer.reply({
    kind: LocalKind.Result,
    requestId: oldId,
    ok: true,
    data: { events: [], before: null, after: null },
  });

  await expect(oldHistory).resolves.toBeNull();
  const currentHistory = client.history('b', true);

  expect(viewer.sent.at(-1)!.action).toMatchObject({
    operation: LocalOperation.History,
    sessionId: 'b',
    generation: 'generation-b',
  });

  viewer.reply({
    kind: LocalKind.Result,
    requestId: viewer.sent.at(-1)!.requestId,
    ok: true,
    data: { events: [], before: null, after: null },
  });

  await expect(currentHistory).resolves.toEqual([]);
  const older = client.historyPage('b', HistoryPageDirection.Before, 'cache:eyJhdCI6MSwic2VxIjoxfQ');

  expect(viewer.sent.at(-1)!.action).toMatchObject({ anchor: 'cache:eyJhdCI6MSwic2VxIjoxfQ' });

  viewer.reply({
    kind: LocalKind.Result,
    requestId: viewer.sent.at(-1)!.requestId,
    ok: true,
    data: { events: [], before: null, after: null },
  });

  await older;
  client.close();
});
