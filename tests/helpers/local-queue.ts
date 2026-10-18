import { LocalPersistence } from '../../apps/daemon/src/local/controller/persistence.js';
import { ClaudeHookEvent } from '../../apps/daemon/src/domain/claude.js';
import {
  CommandActionType,
  LocalOperation,
  PromptDelivery,
  type ClientCommand,
} from '../../packages/protocol/src/index.js';
import { localFixture } from './local-runtime.js';

type QueueFixture = ReturnType<typeof localFixture> & { persistence: LocalPersistence };
type PromptCommand = ClientCommand & {
  action: Extract<ClientCommand['action'], { type: typeof CommandActionType.Prompt }>;
};
const fixtures: QueueFixture[] = [];

export function setup() {
  const fixture = localFixture();
  const value = { ...fixture, persistence: fixture.controller.persistence };

  fixtures.push(value);

  return value;
}

export async function closeFixtures() {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.persistence.close();
    await fixture.close();
  }
}

export async function restartQueue(fixture: QueueFixture) {
  await fixture.persistence.close();
  fixture.persistence = new LocalPersistence(fixture.controller.options);

  return fixture.persistence;
}

export function command(f: QueueFixture, id: string): PromptCommand {
  return {
    commandId: id,
    target: f.session.target,
    sessionId: f.session.id,
    generation: f.session.generation,
    action: { type: CommandActionType.Prompt, text: id, delivery: PromptDelivery.WhenIdle },
  };
}

export function save(f: QueueFixture, revision: number, intents: ClientCommand[]) {
  return f.persistence.execute(f.principal, {
    operation: LocalOperation.QueueSave,
    sessionId: f.session.id,
    generation: f.session.generation,
    revision,
    intents,
  });
}

export function hook(
  f: QueueFixture,
  name: typeof ClaudeHookEvent.UserPromptSubmit | typeof ClaudeHookEvent.Stop,
) {
  f.monitor.ingestHook({ hook_event_name: name, session_id: 'synthetic-session' }, 'managed-test');
}
