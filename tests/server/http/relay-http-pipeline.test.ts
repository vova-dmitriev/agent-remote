import { createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { Controller, Get, Module, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, HttpStatus } from '@protocol';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JsonExpressAdapter } from '../../../apps/server/src/http/pipeline/json-express-adapter.js';
import { createRelay } from '../../../apps/server/src/app/create-relay.js';
import { databaseFixture } from '../../helpers/database.js';
import { initData, testBotToken } from '../../helpers/telegram.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

@Controller('reply')
class ReplyController {
  @Get('null')
  nothing() {
    return null;
  }

  @Get('undefined')
  missing() {
    return undefined;
  }

  @Get('string')
  text() {
    return 'x';
  }

  @Get('number')
  count() {
    return 1;
  }

  @Get('object')
  record() {
    return { a: 1 };
  }

  @Get('written')
  written(@Res({ passthrough: true }) res: Response) {
    res.json({ own: true });

    return { ignored: true };
  }
}

@Module({ controllers: [ReplyController] })
class ReplyModule {}

describe('JSON replies', () => {
  let app: NestExpressApplication;
  let origin: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(ReplyModule, new JsonExpressAdapter(), {
      logger: false,
    });

    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['null', '{}'],
    ['undefined', '{}'],
    ['string', '"x"'],
    ['number', '1'],
    ['object', '{"a":1}'],
    ['written', '{"own":true}'],
  ])('answers a handler returning %s with JSON %s', async (path, body) => {
    const response = await fetch(`${origin}/reply/${path}`);

    expect(response.status).toBe(HttpStatus.Ok);
    expect(response.headers.get('content-type')).toBe(JSON_CONTENT_TYPE);
    expect(await response.text()).toBe(body);
  });
});

describe('relay HTTP pipeline', () => {
  let fixture: Awaited<ReturnType<typeof databaseFixture>>;
  let relay: Awaited<ReturnType<typeof createRelay>>;
  let origin: string;

  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

  const post = (path: string, body: unknown, token?: string) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  // fetch() refuses a body on GET and HEAD, so these requests go through node:http.
  const malformedJson = (method: string, path: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(origin + path);

      const outgoing = request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method,
          headers: { 'content-type': 'application/json', 'content-length': '1' },
        },
        (incoming) => {
          let body = '';

          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => (body += chunk));
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }));
        },
      );

      outgoing.on('error', reject);
      outgoing.end('{');
    });

  beforeAll(async () => {
    fixture = await databaseFixture();

    relay = await createRelay({
      databaseUrl: fixture.url,
      schema: fixture.schema,
      botToken: testBotToken,
      publicOrigin: 'http://localhost',
    });

    origin = await relay.listen(0);
  });

  afterAll(async () => {
    await relay?.close();
    await fixture?.close();
  });

  it('answers a declined pairing confirmation with an empty JSON object', async () => {
    const token = (await relay.auth.login(initData('903'))).token;
    const code = randomBytes(16).toString('hex');
    const proof = randomBytes(32).toString('hex');

    await post('/device/pair/start', { codeHash: sha256(code), proofHash: sha256(proof) });
    const claim = (await (await post('/pair/claim', { code }, token)).json()) as { claimId: string };
    const response = await post('/device/pair/confirm', { proof, claimId: claim.claimId, approved: false });

    expect(response.status).toBe(HttpStatus.Ok);
    expect(response.headers.get('content-type')).toBe(JSON_CONTENT_TYPE);
    expect(await response.text()).toBe('{}');
  });

  it.each([
    ['POST', '/sessions/x/attachments'],
    ['GET', '/sessions/x/attachments/y'],
    ['HEAD', '/sessions/x/attachments/y'],
    ['POST', '/device/sessions/x/attachments'],
    ['GET', '/device/sessions/x/attachments/y'],
    ['HEAD', '/device/sessions/x/attachments/y'],
  ])('leaves the body of %s %s to the attachment routes', async (method, path) => {
    const response = await malformedJson(method, path);

    expect(response.status).toBe(HttpStatus.Unauthorized);

    if (method !== 'HEAD') {
      expect(JSON.parse(response.body)).toEqual({ code: ErrorCode.UNAUTHORIZED });
    }
  });
});
