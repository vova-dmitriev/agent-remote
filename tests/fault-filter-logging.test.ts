import { ConsoleLogger, Logger } from '@nestjs/common';
import { ErrorCode, HttpStatus } from '@protocol';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { logDebug } from '../apps/daemon/src/diagnostics/log.js';
import { createRelay } from '../apps/server/src/app/create-relay.js';
import { describeError } from '../apps/server/src/http/errors/error-log.js';
import { PreferenceService } from '../apps/server/src/preferences/service.js';
import { databaseFixture } from './helpers/database.js';
import { initData, testBotToken } from './helpers/telegram.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let relay: Awaited<ReturnType<typeof createRelay>>;
let origin: string;
let token: string;

beforeAll(async () => {
  fixture = await databaseFixture();

  relay = await createRelay({
    databaseUrl: fixture.url,
    schema: fixture.schema,
    botToken: testBotToken,
    publicOrigin: 'http://localhost',
  });

  origin = await relay.listen(0);
  token = (await relay.auth.login(initData('7301'))).token;
});

afterAll(async () => {
  await relay?.close();
  await fixture?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const secretInitData = initData('7302');
const chatText = 'synthetic chat message text';

it('answers an unexpected controller error with 500 INTERNAL_ERROR and logs it without the request secrets', async () => {
  const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});

  vi.spyOn(PreferenceService.prototype, 'get').mockRejectedValue(
    new Error(`boom ${token} ${secretInitData} ${chatText} https://example.invalid/app?token=${token}`),
  );

  const response = await fetch(origin + '/preferences?token=' + token, {
    headers: { authorization: `Bearer ${token}`, cookie: `agent_remote_refresh=${token}` },
  });

  expect(response.status).toBe(HttpStatus.InternalServerError);
  expect(await response.json()).toEqual({ code: ErrorCode.INTERNAL_ERROR });
  expect(logged).toHaveBeenCalledTimes(1);

  const line = JSON.stringify(logged.mock.calls[0]);

  for (const secret of [token, secretInitData, chatText, 'boom', '?token=']) {
    expect(line).not.toContain(secret);
  }

  expect(logged.mock.calls[0]).toEqual(['Error', expect.stringContaining('    at '), 'FaultFilter']);
});

it('logs nothing for faults and validation errors', async () => {
  const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});

  expect((await fetch(origin + '/preferences')).status).toBe(HttpStatus.Unauthorized);

  const invalid = await fetch(origin + '/preferences', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'neon' }),
  });

  expect(invalid.status).toBe(HttpStatus.BadRequest);
  expect(logged).not.toHaveBeenCalled();
});

it('keeps only a code-like message and the stack frames of an error', () => {
  const plain = describeError(new Error(`Bearer ${'a'.repeat(64)}\nsecond line`));

  expect(plain.message).toBe('Error');
  expect(plain.stack?.split('\n').every((line) => line.startsWith('    at '))).toBe(true);
  expect(JSON.stringify(plain)).not.toContain('Bearer');

  expect(describeError(new TypeError('QUEUE_CLOSE_FAILED')).message).toBe('TypeError: QUEUE_CLOSE_FAILED');
  expect(describeError('a thrown string with content')).toEqual({ message: 'string', stack: undefined });
});

it('writes one JSON line per log entry', () => {
  const logger = new ConsoleLogger({ json: true, logLevels: ['error'] });
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  logger.error('Error', '    at frame', 'FaultFilter');

  expect(write).toHaveBeenCalledTimes(1);

  expect(JSON.parse(String(write.mock.calls[0]![0]))).toMatchObject({
    level: 'error',
    context: 'FaultFilter',
  });
});

it('writes companion debug lines only with REMOTE_DEBUG=1 and never the error message', () => {
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const secret = new Error(`Bearer ${'b'.repeat(64)} ${secretInitData} ${chatText}`);

  vi.stubEnv('REMOTE_DEBUG', '');
  logDebug('runtime/relay-link', secret);
  expect(write).not.toHaveBeenCalled();

  vi.stubEnv('REMOTE_DEBUG', '1');
  logDebug('runtime/relay-link', secret);
  logDebug('runtime/relay-link', new Error('SOURCE_UNAVAILABLE'));

  try {
    expect(write).toHaveBeenCalledTimes(2);

    const [first, second] = write.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
    );

    expect(first).toMatchObject({ scope: 'runtime/relay-link', name: 'Error' });
    expect(first).not.toHaveProperty('code');
    expect(JSON.stringify(first)).not.toMatch(/Bearer|auth_date|synthetic chat/);
    expect(second).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  } finally {
    vi.unstubAllEnvs();
  }
});
