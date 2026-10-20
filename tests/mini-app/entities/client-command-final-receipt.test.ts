import { it, expect } from 'vitest';
import { CommandSubmission } from '../../../apps/mini-app/src/entities/command/api/commands.js';
import type { ClientCommand } from '@protocol';

const command: ClientCommand = {
  commandId: 'original-final',
  target: { kind: 'claude-code-cli', deviceId: 'd', connectorId: 'c', claudeSessionId: 's' },
  sessionId: 's',
  generation: 'g',
  action: { type: 'prompt', text: 'Synthetic receipt race' },
};

for (const status of ['dispatched', 'rejected'] as const) {
  it(`returns the WebSocket ${status} receipt when the original POST subsequently fails`, async () => {
    let posts = 0;
    let lookups = 0;

    const client = new CommandSubmission(async (method) => {
      if (method === 'POST') {
        posts++;
        client.observe({ commandId: command.commandId, status });
        throw new Error('NETWORK_UNAVAILABLE');
      }

      lookups++;
      throw new Error('NETWORK_UNAVAILABLE');
    });

    expect(await client.send(command)).toEqual({ commandId: command.commandId, status });
    expect(posts).toBe(1);
    expect(lookups).toBe(0);
    await expect(client.retryPending()).rejects.toThrow('NO_PENDING_COMMAND');
  });
}
