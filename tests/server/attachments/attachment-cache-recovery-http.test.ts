import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { attachmentRelayFixture } from '../../helpers/relay/attachment-relay.js';

it('rebuilds an evicted native attachment through an authenticated single-message read, preserving its URL', async () => {
  const f = await attachmentRelayFixture();

  try {
    const device = f.connect('/ws/device', f.deviceToken);

    await device.next('authenticated');

    await f.publish(device, {
      ...f.session,
      capabilities: { ...f.session.capabilities, historyWindow: true },
    });

    const bytes = Buffer.from('synthetic native image'),
      id = randomUUID();

    const input = {
      uploadId: id,
      generation: f.session.generation,
      name: 'native.txt',
      mimeType: 'text/plain',
      bytes,
      source: { messageId: 'native-message', position: 'position:synthetic' },
    };

    const descriptor = await f.relay.attachments.store(f.context, input, true);

    // Model eviction after a page has been normalized, without altering its descriptors.
    await f.database.db.pool.query('DELETE FROM attachment_blobs WHERE owner_id=$1 AND sha256=$2', [
      f.principal.userId,
      descriptor.sha256,
    ]);

    const url = f.origin + f.path + '/' + id,
      headers = { authorization: 'Bearer ' + f.token };

    expect((await fetch(url, { method: 'HEAD', headers })).status).toBe(404);
    expect((await fetch(url, { headers: { authorization: 'Bearer ' + f.otherToken } })).status).toBe(404);
    expect(device.frames.filter((frame) => frame.type === 'history_read')).toHaveLength(0);
    const download = fetch(url, { headers });
    const request = await device.next('history_read');

    expect(request).toMatchObject({
      direction: 'message',
      anchor: input.source.position,
      sessionId: f.session.id,
      generation: f.session.generation,
    });

    expect((await f.relay.attachments.store(f.context, { ...input, uploadId: randomUUID() }, true)).id).toBe(
      id,
    );

    device.send({
      type: 'history_item',
      requestId: request.requestId,
      sessionId: request.sessionId,
      generation: request.generation,
      message: {
        id: input.source.messageId,
        role: 'user',
        text: '',
        occurredAt: 1,
        attachments: [descriptor],
      },
    });

    device.send({
      type: 'history_done',
      requestId: request.requestId,
      sessionId: request.sessionId,
      generation: request.generation,
      before: null,
      after: null,
    });

    const response = await download;

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect((await fetch(url, { method: 'HEAD', headers })).status).toBe(204);
    await f.relay.devices.revoke(f.principal, f.deviceId);
    expect((await fetch(url, { headers })).status).toBe(404);
    expect(device.frames.filter((frame) => frame.type === 'history_read')).toHaveLength(1);
  } finally {
    await f.close();
  }
});
