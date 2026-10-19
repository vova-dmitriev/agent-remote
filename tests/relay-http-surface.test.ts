import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, HttpStatus } from '@protocol';
import { HealthStatus } from '../apps/server/src/domain/infrastructure.js';
import { createRelay } from '../apps/server/src/app/create-relay.js';
import { databaseFixture } from './helpers/database.js';
import { initData, testBotToken } from './helpers/telegram.js';

const RouteMethod = {
  Get: 'get',
  Head: 'head',
  Post: 'post',
  Delete: 'delete',
  Patch: 'patch',
  Put: 'put',
} as const;

type RouteMethod = (typeof RouteMethod)[keyof typeof RouteMethod];

const RouteAuth = { Principal: 'principal', Device: 'device', Public: 'public' } as const;

type RouteAuth = (typeof RouteAuth)[keyof typeof RouteAuth];

const ContentType = { Json: 'application/json', JsonUtf8: 'application/json; charset=utf-8' } as const;

const MALFORMED_JSON_MESSAGE = "Expected property name or '}' in JSON at position 1 (line 1 column 2)";
const OVERSIZED_BODY_BYTES = 129 * 1024;

// Every route the relay serves today. /auth/refresh authenticates by cookie and Origin, not by bearer.
const RELAY_ROUTES: Array<[RouteMethod, string, RouteAuth]> = [
  [RouteMethod.Get, '/preferences', RouteAuth.Principal],
  [RouteMethod.Patch, '/preferences', RouteAuth.Principal],
  [RouteMethod.Get, '/health', RouteAuth.Public],
  [RouteMethod.Post, '/auth/telegram', RouteAuth.Public],
  [RouteMethod.Post, '/auth/refresh', RouteAuth.Public],
  [RouteMethod.Post, '/auth/logout', RouteAuth.Principal],
  [RouteMethod.Post, '/device/pair/start', RouteAuth.Public],
  [RouteMethod.Post, '/pair/claim', RouteAuth.Principal],
  [RouteMethod.Post, '/device/pair/cancel', RouteAuth.Public],
  [RouteMethod.Post, '/device/pair/status', RouteAuth.Public],
  [RouteMethod.Post, '/device/pair/confirm', RouteAuth.Public],
  [RouteMethod.Post, '/devices/:deviceId/profiles', RouteAuth.Principal],
  [RouteMethod.Get, '/devices', RouteAuth.Principal],
  [RouteMethod.Delete, '/devices/:id', RouteAuth.Principal],
  [RouteMethod.Get, '/devices/:id/snapshot', RouteAuth.Principal],
  [RouteMethod.Get, '/devices/:id/connectors', RouteAuth.Principal],
  [RouteMethod.Get, '/devices/:id/events', RouteAuth.Principal],
  [RouteMethod.Get, '/sessions/:id/reading-position', RouteAuth.Principal],
  [RouteMethod.Put, '/sessions/:id/reading-position', RouteAuth.Principal],
  [RouteMethod.Get, '/sessions/:id/events', RouteAuth.Principal],
  [RouteMethod.Patch, '/sessions/:id', RouteAuth.Principal],
  [RouteMethod.Post, '/commands', RouteAuth.Principal],
  [RouteMethod.Get, '/commands/:id', RouteAuth.Principal],
  [RouteMethod.Post, '/devices/:deviceId/continuity/sessions/:sessionId/inspect', RouteAuth.Principal],
  [RouteMethod.Post, '/devices/:deviceId/continuity/conversations', RouteAuth.Principal],
  [
    RouteMethod.Get,
    '/devices/:deviceId/continuity/conversations/:conversationId/executions',
    RouteAuth.Principal,
  ],
  [RouteMethod.Post, '/devices/:deviceId/continuity/checkpoints/prepare', RouteAuth.Principal],
  [RouteMethod.Post, '/devices/:deviceId/continuity/checkpoints/:checkpointId/approve', RouteAuth.Principal],
  [RouteMethod.Post, '/continuity/handoffs', RouteAuth.Principal],
  [RouteMethod.Get, '/devices/:deviceId/continuity/handoffs/:operationId', RouteAuth.Principal],
  [RouteMethod.Post, '/devices/:deviceId/continuity/handoffs/:operationId/reconcile', RouteAuth.Principal],
  [RouteMethod.Post, '/sessions/:sessionId/attachments', RouteAuth.Principal],
  [RouteMethod.Head, '/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Principal],
  [RouteMethod.Get, '/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Principal],
  [RouteMethod.Post, '/device/sessions/:sessionId/attachments', RouteAuth.Device],
  [RouteMethod.Head, '/device/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Device],
  [RouteMethod.Get, '/device/sessions/:sessionId/attachments/:attachmentId', RouteAuth.Device],
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
      ...(method === RouteMethod.Get || method === RouteMethod.Head ? {} : { body: '{}' }),
    });

    expect(response.status).toBe(HttpStatus.Unauthorized);

    if (method !== RouteMethod.Head) {
      expect(await response.json()).toEqual({ code: ErrorCode.UNAUTHORIZED });
    }
  });

  // One cheap rejection per public route proves the route is still mounted; a vanished route would answer 404.
  const PUBLIC_PROBES: Array<[string, RequestInit, HttpStatus, { code: ErrorCode }]> = [
    [
      '/auth/telegram',
      { method: 'POST', headers: jsonHeaders(), body: '{}' },
      HttpStatus.BadRequest,
      { code: ErrorCode.INVALID_REQUEST },
    ],
    [
      '/auth/refresh',
      { method: 'POST', headers: jsonHeaders(), body: '{}' },
      HttpStatus.Forbidden,
      { code: ErrorCode.ACCESS_DENIED },
    ],
    [
      '/device/pair/start',
      { method: 'POST', headers: jsonHeaders(), body: '{}' },
      HttpStatus.BadRequest,
      { code: ErrorCode.INVALID_REQUEST },
    ],
    [
      '/device/pair/cancel',
      { method: 'POST', headers: jsonHeaders(), body: '{}' },
      HttpStatus.BadRequest,
      { code: ErrorCode.INVALID_REQUEST },
    ],
    [
      '/device/pair/status',
      { method: 'POST', headers: jsonHeaders(), body: '{}' },
      HttpStatus.BadRequest,
      { code: ErrorCode.INVALID_REQUEST },
    ],
    [
      '/device/pair/confirm',
      { method: 'POST', headers: jsonHeaders(), body: '{}' },
      HttpStatus.BadRequest,
      { code: ErrorCode.INVALID_REQUEST },
    ],
  ];

  it('probes every public route except health, which has its own case', () => {
    const probed = new Set(PUBLIC_PROBES.map(([path]) => path));

    const publicPaths = RELAY_ROUTES.filter(([, , auth]) => auth === RouteAuth.Public)
      .map(([, path]) => path)
      .filter((path) => path !== '/health');

    expect(publicPaths.filter((path) => !probed.has(path))).toEqual([]);
  });

  it.each(PUBLIC_PROBES)('rejects a cheap request to public %s', async (path, init, status, body) => {
    const response = await fetch(origin + path, init);

    expect(response.status).not.toBe(HttpStatus.NotFound);
    expect(response.status).not.toBe(HttpStatus.Unauthorized);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
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
