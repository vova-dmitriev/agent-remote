import { CodedError, ErrorCode, type ModelChoice, SessionStatus } from '@protocol';
import type { MonitorPort } from '../domain/ports/monitor.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { SessionModelPort } from '../domain/ports/session-names.js';

interface SessionModelSwitchDeps {
  monitor: MonitorPort;
  adapters: Pick<AdapterRegistry, 'resolve'>;
}

/** Switches a running session to the model the owner picked in the app. */
export class SessionModelSwitch implements SessionModelPort {
  constructor(private readonly deps: SessionModelSwitchDeps) {}

  /**
   * A Codex thread takes the model with its next turn. A Claude session that takes typed input runs `/model` and
   * `/effort`, which Claude applies at once, even mid-turn; any other state may be a dialog that Enter would answer.
   */
  async switch(sessionId: string, choice: ModelChoice): Promise<void> {
    const { monitor, adapters } = this.deps;
    const session = monitor.session(sessionId);
    const binding = monitor.binding(sessionId);

    if (!session || !binding) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    const adapter = adapters.resolve(session.target);

    if ('threadId' in session.target) {
      await adapter.setModel(binding, choice);
    } else {
      if (
        !session.capabilities.prompt ||
        ![SessionStatus.Idle, SessionStatus.Running].some((status) => status === session.status)
      ) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      await adapter.sendPrompt(binding, `/model ${choice.model}`);

      if (choice.effort) {
        await adapter.sendPrompt(binding, `/effort ${choice.effort}`);
      }
    }

    monitor.setSessionModel(sessionId, choice.model);
  }
}
