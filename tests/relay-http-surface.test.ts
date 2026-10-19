import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, HttpStatus } from '@protocol';
import { HealthStatus, HttpMethod } from '../apps/server/src/domain/http.js';
import { createRelay } from '../apps/server/src/relay.js';
import { databaseFixture } from './helpers/database.js';
import { initData, testBotToken } from './helpers/telegram.js';

const HeadMethod = 'head';

type RouteMethod = HttpMethod | typeof HeadMethod;

const RouteAuth = { Principal: 'principal', Device: 'device', Public: 'public' } as const;

type RouteAuth = (typeof RouteAuth)[keyof typeof RouteAuth];

const ContentType = { Json: 'application/json', JsonUtf8: 'application/json; charset=utf-8' } as const;

const MALFORMED_JSON_MESSAGE = "Expected property name or '}' in JSON at position 1 (line 1 column 2)";
const OVERSIZED_BODY_BYTES = 129 * 1024;

// Every route the relay serves today. /auth/refresh authenticates by cookie and Origin, not by bearer.
const RELAY_ROUTES: Array<[RouteMethod, string, RouteAuth]> = [
  [HttpMethod.Get, '/preferences', RouteAuth.Principal],
  [HttpMethod.Patch, '/preferences', RouteAuth.Principal],
  [HttpMethod.Get, '/health', RouteAuth.Public],
  [HttpMethod.Post, '/auth/telegram', RouteAuth.Public],
  [HttpMethod.Post, '/auth/refresh', RouteAuth.Public],
  [HttpMethod.Post, '/auth/logout', RouteAuth.Principal],
  [HttpMethod.Post, '/device/pair/start', RouteAuth.Public],
  [HttpMethod.Post, '/pair/claim', RouteAuth.Principal],
  [HttpMethod.Post, '/device/pair/cancel', RouteAuth.Public],
  [HttpMethod.Post, '/device/pair/status', RouteAuth.Public],
  [HttpMethod.Post, '/device/pair/confirm', RouteAuth.Public],
  [HttpMethod.Post, '/devices/:deviceId/profiles', RouteAuth.Principal],
  [HttpMethod.Get, '/devices', RouteAuth.Principal],
  [HttpMethod.Delete, '/devices/:id', RouteAuth.Principal],
  [HttpMethod.Get, '/devices/:id/snapshot', RouteAuth.Principal],
  [HttpMethod.Get, '/devices/:id/connectors', RouteAuth.Principal],
  [HttpMethod.Get, '/devices/:id/events', RouteAuth.Principal],
  [HttpMethod.Get, '/sessions/:id/reading-position', RouteAuth.Principal],
  [HttpMethod.Put, '/sessions/:id/reading-position', RouteAuth.Principal],
  [HttpMethod.Get, '/sessions/:id/events', RouteAuth.Principal],
  [HttpMethod.Patch, '/sessions/:id', RouteAuth.Principal],
  [HttpMethod.Post, '/commands', RouteAuth.Principal],
  [HttpMethod.Get, '/commands/:id', RouteAuth.Principal],
  [HttpMethod.Post, '/devices/:deviceId/continuity/sessions/:sessionId/inspect', RouteAuth.Principal],
  [HttpMethod.Post, '/devices/:deviceId/continuity/conversations', RouteAuth.Principal],
  [
    HttpMethod.Get,
    '/devices/:deviceId/continuity/conversations/:conversationId/executions',
    RouteAuth.Principal,
  ],
  [HttpMethod.Post, '/devices/:deviceId/continuity/checkpoints/prepare', RouteAuth.Principal],
  [HttpMethod.Post, '/devices/:deviceId/continuity/checkpoints/:checkpointId/approve', RouteAuth.Principal],
  [HttpMethod.Post, '/continuity/handoffs', RouteAuth.Principal],
  [HttpMethod.Get, '/devices/:deviceId/continuity/handoffs/:operationId', RouteAuth.Principal],
  [HttpMethod.Post, '/devices/:deviceId/continuity/handoffs/:operationId/reconcile', RouteAuth.Principal],
  [HttpMethod.Post, '/sessions/:sessionId/attachments', RouteAuth.Principal],
  [HeadMethod, '/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Principal],
  [HttpMethod.Get, '/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Principal],
  [HttpMethod.Post, '/device/sessions/:sessionId/attachments', RouteAuth.Device],
  [HeadMethod, '/device/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Device],
  [HttpMethod.Get, '/device/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Device],
];

const concretePath = (path: string) => path.replace(/:\w+/gu, 'x');

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let relay: Awaited<ReturnType<typeof createRelay>>;
let origin: string;
let token: string;

const jsonHeaders = (bearer?: string) => ({
  'content-type': ContentType.Json,
  ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
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
  token = (await relay.auth.login(initData('701'))).token;
});

afterAll(async () => {
  await relay?.close();
  await fixture?.close();
});

describe('relay HTTP surface', () => {
  it('lists every route exactly once', () => {
    const keys = RELAY_ROUTES.map(([method, path]) => `${method} ${path}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(RELAY_ROUTES).toHaveLength(37);
  });

  const guarded = RELAY_ROUTES.filter(([, , auth]) => auth !== RouteAuth.Public);

  it.each(guarded)('rejects %s %s (%s) without Authorization', async (method, path) => {
    const response = await fetch(origin + concretePath(path), {
      method: method.toUpperCase(),
      headers: jsonHeaders(),
      ...(method === HttpMethod.Get || method === HeadMethod ? {} : { body: '{}' }),
    });

    expect(response.status).toBe(HttpStatus.Unauthorized);

    if (method !== HeadMethod) {
      expect(await response.json()).toEqual({ code: ErrorCode.UNAUTHORIZED });
    }
  });

  it('serves health with the hardening headers and no x-powered-by', async () => {
    const response = await fetch(origin + '/health');

    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.json()).toEqual({ status: HealthStatus.Ok });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('x-powered-by')).toBe(false);
  });

  it('answers malformed JSON with the framework 400 body', async () => {
    const response = await fetch(origin + '/preferences', {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: '{',
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(response.headers.get('content-type')).toBe(ContentType.JsonUtf8);

    expect(await response.json()).toEqual({
      message: MALFORMED_JSON_MESSAGE,
      error: 'Bad Request',
      statusCode: HttpStatus.BadRequest,
    });
  });

  it('answers a 129 KB JSON body with the framework 413 body', async () => {
    const response = await fetch(origin + '/preferences', {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ language: 'x'.repeat(OVERSIZED_BODY_BYTES) }),
    });

    expect(response.status).toBe(HttpStatus.PayloadTooLarge);
    expect(response.headers.get('content-type')).toBe(ContentType.JsonUtf8);

    expect(await response.json()).toEqual({
      statusCode: HttpStatus.PayloadTooLarge,
      message: 'request entity too large',
    });
  });

  it('answers an unknown path with the framework 404 body', async () => {
    const response = await fetch(origin + '/no-such-path');

    expect(response.status).toBe(HttpStatus.NotFound);
    expect(response.headers.get('content-type')).toBe(ContentType.JsonUtf8);

    expect(await response.json()).toEqual({
      message: 'Cannot GET /no-such-path',
      error: 'Not Found',
      statusCode: HttpStatus.NotFound,
    });
  });

  it('rejects an invalid command body for an authenticated user', async () => {
    const response = await fetch(origin + '/commands', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: '{}',
    });

    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(await response.json()).toEqual({ code: ErrorCode.INVALID_REQUEST });
  });
});
