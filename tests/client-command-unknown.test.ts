import { describe, it, expect } from 'vitest';
import { CommandSubmission } from '../apps/mini-app/src/entities/command/api/commands.js';
import type { ClientCommand } from '@protocol';

const command: ClientCommand = {
  commandId: 'original-unknown',
  target: { kind: 'claude-code-cli', deviceId: 'd', connectorId: 'c', claudeSessionId: 's' },
  sessionId: 's',
  generation: 'g',
  action: {
    type: 'prompt',
    text: '',
    attachments: [
      {
        id: 'original-image',
        name: 'synthetic.png',
        mimeType: 'image/png',
        byteLength: 1,
        kind: 'image',
        sha256: '0'.repeat(64),
      },
    ],
  },
};

describe('explicit unknown browser command recovery', () => {
  for (const loseResponse of [false, true]) {
    it(`preserves exact pending intent across unknown status (lost POST: ${loseResponse})`, async () => {
      const posts: ClientCommand[] = [];
      const lookups: string[] = [];

      const client = new CommandSubmission(async (method, path, body) => {
        if (method === 'POST') {
          posts.push(structuredClone(body!));

          if (loseResponse) {
            throw new Error('NETWORK_UNAVAILABLE');
          }
        } else {
          lookups.push(path);
        }

        return { commandId: command.commandId, status: 'unknown' };
      });

      expect((await client.send(command)).status).toBe('unknown');
      expect((await client.retryPending()).status).toBe('unknown');
      expect((await client.retryPending()).status).toBe('unknown');

      await expect(
        client.send({ ...command, action: { type: 'prompt', text: 'different side effect' } }),
      ).rejects.toThrow('COMMAND_PENDING_STATUS');

      expect(posts).toEqual([command]);
      expect(lookups.every((path) => path === '/commands/' + command.commandId)).toBe(true);
    });
  }
});
