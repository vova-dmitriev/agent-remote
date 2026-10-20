import { ConsoleLogger } from '@nestjs/common';
import { ErrorCode, HttpStatus } from '@protocol';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { logDebug } from '../../../apps/daemon/src/diagnostics/log.js';
import { createRelay } from '../../../apps/server/src/app/create-relay.js';
import { PreferenceService } from '../../../apps/server/src/preferences/service.js';
import { redactError } from '@transport/diagnostics/redact-error.js';
import { databaseFixture } from '../../helpers/database.js';
import { initData, testBotToken } from '../../helpers/telegram.js';

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
  // The instance path every Nest logger ends in, and the bytes it writes: nothing reaches stderr unredacted.
  const logged = vi.spyOn(ConsoleLogger.prototype, 'error');
  const written = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  vi.spyOn(PreferenceService.prototype, 'get').mockRejectedValue(
    new Error(`boom ${token} ${secretInitData} ${chatText} https://example.invalid/app?token=${token}`),
  );

  const response = await fetch(origin + '/preferences?token=' + token, {
    headers: { authorization: `Bearer ${token}`, cookie: `agent_remote_refresh=${token}` },
  });

  expect(response.status).toBe(HttpStatus.InternalServerError);
  expect(await response.json()).toEqual({ code: ErrorCode.INTERNAL_ERROR });
  expect(logged).toHaveBeenCalledTimes(1);

  expect(logged.mock.calls[0]).toEqual(['Error', expect.stringContaining('    at '), 'FaultFilter']);
  expect(written).toHaveBeenCalledTimes(1);

  const line = String(written.mock.calls[0]![0]);

  expect(JSON.parse(line)).toMatchObject({ level: 'error', context: 'FaultFilter', message: 'Error' });

  for (const secret of [token, secretInitData, chatText, 'boom', '?token=', 'agent_remote_refresh']) {
    expect(line + JSON.stringify(logged.mock.calls)).not.toContain(secret);
  }
});

it('logs nothing for faults and validation errors', async () => {
  const logged = vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => {});

  expect((await fetch(origin + '/preferences')).status).toBe(HttpStatus.Unauthorized);

  const invalid = await fetch(origin + '/preferences', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'neon' }),
  });

  expect(invalid.status).toBe(HttpStatus.BadRequest);
  expect(logged).not.toHaveBeenCalled();
});

it('keeps only names, code-like messages, safe codes and stack frames of an error', () => {
  const plain = redactError(new Error(`Bearer ${'a'.repeat(64)}\nsecond line`));

  expect(plain.message).toBe('Error');
  expect(plain.stack?.split('\n').every((line) => line.startsWith('    at '))).toBe(true);
  expect(JSON.stringify(plain)).not.toMatch(/Bearer|second line/);

  expect(redactError(new TypeError('QUEUE_CLOSE_FAILED')).message).toBe('TypeError: QUEUE_CLOSE_FAILED');
  expect(redactError('a thrown string with content')).toEqual({ message: 'string' });

  const coded = (code: string) => redactError(Object.assign(new Error('detail'), { code })).code;

  expect(coded('ECONNRESET')).toBe('ECONNRESET');
  expect(coded('23503')).toBe('23503');
  expect(coded('secret value')).toBeUndefined();
  expect(coded('A'.repeat(41))).toBeUndefined();
});

it('logs the SQLSTATE a query builder keeps as cause, never its query text or parameters', () => {
  const wrapped = new Error(
    'Failed query: insert into "session_labels" values ($1, $2)\nparams: owner-secret,Synthetic private title',
    { cause: Object.assign(new Error('violates foreign key constraint'), { code: '23503' }) },
  );

  const logged = redactError(wrapped);

  expect(logged.code).toBe('23503');
  expect(JSON.stringify(logged)).not.toMatch(/owner-secret|Synthetic private title|insert into/);
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

    expect(first).toMatchObject({ scope: 'runtime/relay-link', message: 'Error' });
    expect(JSON.stringify(first)).not.toMatch(/Bearer|auth_date|synthetic chat/);
    expect(second).toMatchObject({ message: 'Error: SOURCE_UNAVAILABLE' });
  } finally {
    vi.unstubAllEnvs();
  }
});
