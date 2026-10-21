import { CodedError, ErrorCode, type ModelChoice, SessionStatus } from '@protocol';
import type { MonitorPort } from '../domain/ports/monitor.js';
import type { AdapterRegistry, Binding } from '../adapters/registry.js';
import { setTimeout as delay } from 'node:timers/promises';
import { logDebug } from '../diagnostics/log.js';
import type { SessionModelPort } from '../domain/ports/session-names.js';

interface SessionModelSwitchDeps {
  monitor: MonitorPort;
  adapters: Pick<AdapterRegistry, 'resolve'>;
  /** Waits between looks at the screen; tests pass one that does not. */
  wait?: (ms: number) => Promise<unknown>;
}

/** The answer Claude Code focuses in its "Switch model?" and "Change effort level?" dialogs. */
const SWITCH_CONFIRMATION = 'Yes, switch to';
/** How long, and how often, to look for that dialog after a command. */
const DIALOG_WAIT = { TotalMs: 3_000, StepMs: 250 } as const;
/** The bottom of the screen, where the dialog opens; older lines may hold an earlier, answered one. */
const DIALOG_LINES = 20;

type Adapter = ReturnType<AdapterRegistry['resolve']>;

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

      await this.command(adapter, binding, `/model ${choice.model}`);

      if (choice.effort) {
        await this.command(adapter, binding, `/effort ${choice.effort}`);
      }
    }

    monitor.setSessionModel(sessionId, choice.model);
  }

  /**
   * Runs a Claude command and answers the confirmation Claude asks for when the conversation's cache is warm: its
   * focused answer is Yes, so Enter takes it. A session whose screen cannot be read leaves the dialog to the owner.
   */
  private async command(adapter: Adapter, binding: Binding, text: string) {
    await adapter.sendPrompt(binding, text);

    const wait = this.deps.wait ?? delay;

    for (let waited = 0; waited < DIALOG_WAIT.TotalMs; waited += DIALOG_WAIT.StepMs) {
      await wait(DIALOG_WAIT.StepMs);

      // A session whose screen cannot be read (no terminal snapshot) leaves the dialog to the owner.
      const screen = await adapter.readScreen(binding).catch((error: unknown) => {
        logDebug('sessions/session-model', error);

        return undefined;
      });

      if (screen === undefined) {
        return;
      }

      if (
        screen
          .split('\n')
          .slice(-DIALOG_LINES)
          .some((line) => line.includes(SWITCH_CONFIRMATION))
      ) {
        await adapter.pressEnter(binding);

        return;
      }
    }
  }
}
