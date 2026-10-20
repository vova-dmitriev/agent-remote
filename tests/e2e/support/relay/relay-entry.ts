// Child process entry for the e2e relay: `node --import tsx tests/e2e/support/relay-entry.ts`.
// Playwright never loads this file, so its Babel transform never compiles the decorator-based server code.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientCommand } from '@protocol';
import { NotificationDelivery } from '@server/notifications/delivery.js';
import { NotificationRepository } from '@server/notifications/repositories/notifications.js';
import { NotificationWorker } from '@server/notifications/worker.js';
import { createRelay } from '@server/app/create-relay.js';
import { testBotToken } from '../../../helpers/relay/telegram.js';
import {
  CONTROL_TOKEN_HEADER,
  RELAY_CONFIG_ENV,
  RELAY_READY_PREFIX,
  RelayControlMethod,
  decodeControl,
  encodeControl,
  type ControlRequest,
  type ControlResponse,
  type RelayProcessConfig,
} from './relay-control.js';

const config = JSON.parse(process.env[RELAY_CONFIG_ENV] ?? '') as RelayProcessConfig;

const relay = await createRelay({
  databaseUrl: config.databaseUrl,
  schema: config.schema,
  botToken: testBotToken,
  publicOrigin: config.publicOrigin,
  inputEnabled: config.inputEnabled,
  permissionsEnabled: config.permissionsEnabled,
});

type Principal = Awaited<ReturnType<typeof relay.auth.authenticate>>;
type Context = Parameters<typeof relay.attachments.store>[0];
type Upload = Parameters<typeof relay.attachments.store>[1];
type Updates = Parameters<NotificationWorker['updates']>[0];

async function deliverNotification(appUrl: string, outboxId: string) {
  const sent: unknown[] = [];

  const delivery = new NotificationDelivery(new NotificationRepository(relay.db), appUrl, async (body) => {
    sent.push(body);

    return { ok: true };
  });

  await delivery.deliver(Date.now(), outboxId);

  return sent;
}

const handlers: Record<RelayControlMethod, (args: unknown[]) => unknown> = {
  [RelayControlMethod.Login]: ([initData]) => relay.auth.login(initData as string),
  [RelayControlMethod.Authenticate]: ([token]) => relay.auth.authenticate(token as string),
  [RelayControlMethod.PairStart]: ([codeHash, proofHash]) => relay.devices.start(codeHash as string, proofHash as string),
  [RelayControlMethod.PairClaim]: ([p, code]) => relay.devices.claim(p as Principal, code as string),
  [RelayControlMethod.PairConfirm]: ([proof, claimId, approved]) =>
    relay.devices.confirm(proof as string, claimId as string, approved as boolean),
  [RelayControlMethod.PairStatus]: ([proof]) => relay.devices.status(proof as string),
  [RelayControlMethod.DeviceOwned]: ([p, deviceId]) => relay.devices.owned(p as Principal, deviceId as string),
  [RelayControlMethod.Command]: ([p, command]) => relay.command(p as Principal, command as ClientCommand),
  [RelayControlMethod.LiveHas]: ([deviceId]) => relay.live.has(deviceId as string),
  [RelayControlMethod.StoreAttachment]: ([context, upload, deviceExport]) =>
    relay.attachments.store(context as Context, upload as Upload, deviceExport as boolean),
  [RelayControlMethod.BotUpdates]: ([updates]) =>
    new NotificationWorker(relay.db, testBotToken, config.publicOrigin).updates(updates as Updates),
  [RelayControlMethod.DeliverNotification]: ([appUrl, outboxId]) => deliverNotification(appUrl as string, outboxId as string),
};

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString('utf8');
}

async function answer(request: IncomingMessage): Promise<ControlResponse> {
  const { method, args } = decodeControl(await readBody(request)) as ControlRequest;

  try {
    return { value: (await handlers[method](args)) ?? null };
  } catch (error) {
    const failure = error as { code?: unknown; message?: unknown };

    return { error: { code: typeof failure.code === 'string' ? failure.code : undefined, message: String(failure.message) } };
  }
}

const control = createServer((request, response) => {
  if (request.headers[CONTROL_TOKEN_HEADER] !== config.controlToken) {
    response.writeHead(403).end();

    return;
  }

  void answer(request).then(
    (result) => response.writeHead(200, { 'content-type': 'application/json' }).end(encodeControl(result)),
    () => response.writeHead(400).end(),
  );
});

const origin = await relay.listen(config.port);

await new Promise<void>((resolve) => control.listen(0, '127.0.0.1', resolve));
const controlUrl = `http://127.0.0.1:${(control.address() as AddressInfo).port}`;
let stopping: Promise<void> | undefined;

const stop = () => {
  stopping ??= (async () => {
    control.close();
    await relay.close();
  })().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};

process.on('SIGTERM', stop);
// The parent holds stdin open; its end means the Playwright worker is gone, so the relay must not outlive it.
process.stdin.on('end', stop);
process.stdin.resume();
process.stdout.write(RELAY_READY_PREFIX + JSON.stringify({ origin, control: controlUrl }) + '\n');
