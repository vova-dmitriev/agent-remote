import { expect, it } from 'vitest';
import { AttachmentService } from '../apps/daemon/src/attachments/service.js';
import { attachmentPrompt } from '../apps/daemon/src/attachments/content/input.js';
import { attachmentLocalRelay } from './helpers/attachment-local-relay.js';

it('keeps distinct local history IDs when relay deduplication would collapse attachments to one ID', async () => {
  const f = await attachmentLocalRelay(true);

  try {
    const first = await f.upload();
    const second = await f.upload();
    const prepared = await f.service.prepare(f.session, [first, second]);

    const message = {
      id: 'sent',
      role: 'user' as const,
      text: attachmentPrompt('', prepared),
      occurredAt: 1,
    };

    await f.service.remember(f.session, '', prepared);
    expect(f.service.restore(f.session, message).attachments).toEqual([first, second]);
    const restarted = new AttachmentService({ directory: f.directory, local: f.media });

    try {
      await restarted.ready();
      expect(restarted.restore(f.session, message).attachments).toEqual([first, second]);
    } finally {
      await restarted.close();
    }

    expect(prepared.map((item) => item.descriptor)).toEqual([first, second]);
  } finally {
    await f.cleanup();
  }
});
