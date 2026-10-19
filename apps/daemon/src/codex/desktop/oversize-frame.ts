/** Routing fields recovered from a frame too large to buffer; absent when not found at their exact path. */
export interface OversizeFrameRoute {
  type?: string;
  requestId?: string;
  sourceClientId?: string;
  conversationId?: string;
}

const JsonByte = {
  Quote: 0x22,
  Backslash: 0x5c,
  OpenObject: 0x7b,
  CloseObject: 0x7d,
  OpenArray: 0x5b,
  CloseArray: 0x5d,
  Comma: 0x2c,
  Colon: 0x3a,
  Space: 0x20,
  Tab: 0x09,
  LineFeed: 0x0a,
  CarriageReturn: 0x0d,
} as const;

const jsonWhitespace: ReadonlySet<number> = new Set([
  JsonByte.Space,
  JsonByte.Tab,
  JsonByte.LineFeed,
  JsonByte.CarriageReturn,
]);

const RouteDepth = { Frame: 1, Params: 2 } as const;

/** JSON property paths of the routing fields: wire field names, not domain values. */
const routedFrameFields: ReadonlySet<string> = new Set<keyof OversizeFrameRoute>([
  'type',
  'requestId',
  'sourceClientId',
]);

const PARAMS_FIELD = 'params';
const CONVERSATION_FIELD: keyof OversizeFrameRoute = 'conversationId';

/** Longest routing key or value kept; longer strings are treated as absent. */
const ROUTE_STRING_LIMIT = 512;

/**
 * Consumes one oversize IPC frame payload and discards it as it streams through. Only the
 * top-level `type`, `requestId` and `sourceClientId` and `params.conversationId` are kept,
 * so a nested id inside the payload is never mistaken for the frame's own route.
 *
 * A payload that is not one JSON object filling the whole length (a garbled length header,
 * stray closers, bytes after the object, raw control bytes) is reported as `invalid` as soon
 * as it is detected.
 */
export class OversizeFrame {
  private remaining: number;
  private depth = 0;
  private readonly objects: boolean[] = [];
  private expectKey = false;
  private inString = false;
  private escaped = false;
  private stringIsKey = false;
  private capture: number[] | null = null;
  private frameKey: string | undefined;
  private paramsKey: string | undefined;
  private readonly fields: OversizeFrameRoute = {};
  private malformed = false;
  private complete = false;

  constructor(length: number) {
    this.remaining = length;
  }

  get done() {
    return this.remaining === 0;
  }

  /** The bytes cannot be one framed JSON object; the stream position is no longer trustworthy. */
  get invalid() {
    return this.malformed || (this.done && !this.complete);
  }

  /** Scans up to the rest of this frame from `chunk` and returns how many bytes belonged to it. */
  consume(chunk: Buffer): number {
    const used = Math.min(this.remaining, chunk.length);

    for (let index = 0; index < used && !this.malformed; index++) {
      this.scan(chunk[index]!);
    }

    this.remaining -= used;

    return used;
  }

  route(): OversizeFrameRoute {
    return { ...this.fields };
  }

  private scan(byte: number) {
    // JSON allows no raw control bytes anywhere; they are a following frame's length header.
    if (byte < JsonByte.Space && !jsonWhitespace.has(byte)) {
      this.malformed = true;

      return;
    }

    if (this.inString) {
      this.scanString(byte);

      return;
    }

    if (jsonWhitespace.has(byte)) {
      return;
    }

    // Only one object may fill the frame: nothing before its `{` and nothing after its `}`.
    if (this.complete || (this.depth === 0 && byte !== JsonByte.OpenObject)) {
      this.malformed = true;

      return;
    }

    switch (byte) {
      case JsonByte.Quote:
        this.inString = true;
        this.stringIsKey = this.expectKey;
        this.capture = this.routed() ? [] : null;
        break;
      case JsonByte.OpenObject:
      case JsonByte.OpenArray:
        this.depth++;
        this.expectKey = byte === JsonByte.OpenObject;

        if (this.depth <= RouteDepth.Params) {
          this.objects[this.depth - 1] = this.expectKey;
        }

        if (this.depth === RouteDepth.Params) {
          this.paramsKey = undefined;
        }

        break;
      case JsonByte.CloseObject:
      case JsonByte.CloseArray:
        this.depth--;
        this.expectKey = false;
        this.complete = this.depth === 0;
        break;
      case JsonByte.Comma:
        this.expectKey = this.depth <= RouteDepth.Params && this.objects[this.depth - 1] === true;
        break;
      case JsonByte.Colon:
        this.expectKey = false;
        break;
    }
  }

  private scanString(byte: number) {
    if (this.escaped) {
      this.escaped = false;

      return;
    }

    if (byte === JsonByte.Backslash) {
      // Routing ids never contain escapes; an escaped string is not a route.
      this.escaped = true;
      this.capture = null;

      return;
    }

    if (byte === JsonByte.Quote) {
      this.inString = false;
      this.finishString();

      return;
    }

    if (this.capture) {
      if (this.capture.length < ROUTE_STRING_LIMIT) {
        this.capture.push(byte);
      } else {
        this.capture = null;
      }
    }
  }

  private routed() {
    if (this.stringIsKey) {
      return (
        this.depth === RouteDepth.Frame ||
        (this.depth === RouteDepth.Params && this.frameKey === PARAMS_FIELD)
      );
    }

    if (this.depth === RouteDepth.Frame) {
      return this.frameKey !== undefined && routedFrameFields.has(this.frameKey);
    }

    return (
      this.depth === RouteDepth.Params &&
      this.objects[RouteDepth.Params - 1] === true &&
      this.frameKey === PARAMS_FIELD &&
      this.paramsKey === CONVERSATION_FIELD
    );
  }

  private finishString() {
    const value = this.capture ? Buffer.from(this.capture).toString('utf8') : undefined;

    this.capture = null;

    if (this.stringIsKey) {
      if (this.depth === RouteDepth.Frame) {
        this.frameKey = value;
      } else if (this.depth === RouteDepth.Params) {
        this.paramsKey = value;
      }

      return;
    }

    if (value === undefined) {
      return;
    }

    if (this.depth === RouteDepth.Params) {
      this.fields.conversationId = value;
    } else if (this.frameKey !== undefined && this.depth === RouteDepth.Frame) {
      this.fields[this.frameKey as keyof OversizeFrameRoute] = value;
    }
  }
}
