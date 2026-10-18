import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const settings = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const path = join(process.env.CODEX_HOME, 'auth.json');
const profileRef = createHash('sha256').update(process.env.CODEX_HOME).digest('hex').slice(0, 12);
let changed = false;

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);

  if (!request.id) {
    continue;
  }

  let result = {};

  if (request.method === 'account/read') {
    const credential = JSON.parse(readFileSync(path, 'utf8'));

    result = {
      requiresOpenaiAuth: true,
      account: credential.OPENAI_API_KEY
        ? { type: 'apiKey' }
        : {
            type: 'chatgpt',
            email: changed
              ? 'unexpected@synthetic.invalid'
              : (settings.email ?? `${profileRef}@synthetic.invalid`),
            planType: 'synthetic-plan',
          },
    };
  } else if (request.method === 'model/list') {
    result = {
      data: [
        {
          id: 'synthetic-offer',
          model: 'synthetic-model',
          hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
        },
      ],
      nextCursor: settings.cycle ? 'same-cursor' : null,
    };

    changed = settings.changeIdentity ?? false;
  } else if (request.method === 'account/login/start') {
    if (request.params.type === 'apiKey') {
      writeFileSync(path, JSON.stringify({ OPENAI_API_KEY: request.params.apiKey }), { mode: 0o600 });
      result = { type: 'apiKey' };
    } else {
      if (settings.completeSubscription) {
        writeFileSync(path, JSON.stringify({ tokens: { account_id: 'workspace-' + profileRef } }), {
          mode: 0o600,
        });
      }

      result = {
        type: 'chatgpt',
        loginId: 'synthetic-login',
        authUrl: settings.authUrl ?? 'https://auth.openai.com/authorize?state=synthetic-only',
      };
    }
  }

  process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
}
