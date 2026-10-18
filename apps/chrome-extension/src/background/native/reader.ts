import {
  ErrorCode,
  localEventSchema,
  localResultSchema,
  type LocalClientResponse,
} from '../../../../../packages/protocol/src/index.js';
import { FragmentReader } from '../../../../../packages/transport/src/native/fragments.js';
import type { BrokerPending } from '../pending.js';

interface Handlers {
  current(): boolean;
  lease(): string;
  helloId(): string;
  hello(response: LocalClientResponse): Promise<void>;
  send(value: unknown): void;
}

export class NativeReader {
  private fragments = new FragmentReader();

  constructor(
    private pending: BrokerPending,
    private handlers: Handlers,
  ) {}

  async accept(message: unknown) {
    if (!this.handlers.current()) {
      return;
    }

    const decoded = this.fragments.accept(message);

    if (decoded === undefined) {
      return;
    }

    const result = localResultSchema.safeParse(decoded);

    if (result.success) {
      if (!this.pending.consume(result.data.requestId)) {
        return;
      }

      if (result.data.requestId === this.handlers.helloId()) {
        await this.handlers.hello(result.data);
      } else {
        this.handlers.send(result.data);
      }

      return;
    }

    const event = localEventSchema.parse(decoded);

    if (!this.handlers.lease() || event.lease !== this.handlers.lease()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    this.handlers.send(event);
  }

  clear() {
    this.fragments.clear();
  }
}
