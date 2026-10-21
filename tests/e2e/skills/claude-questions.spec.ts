import { expect } from '@playwright/test';
import { CommandActionType, FrameType, SessionStatus } from '@protocol';
import { test, deviceFixture, delivered } from '../support/relay/relay-fixture.js';
import { identity } from '../support/relay/identity.js';
import { sessionSnapshot } from '../support/fixtures/session-fixtures.js';
import { byTestId } from '../support/ui/testid.js';
import { SESSION_CARD_IDS } from '@/entities/session/config/test-ids.js';
import { USER_INPUT_IDS } from '@/pages/session/config/test-ids.js';
import { COMMAND_IDS } from '@/features/send-command/config/test-ids.js';

test('Claude multiple-choice question can be answered and the composer accepts further instructions while running', async ({ page }) => {
  const { sockets, deviceId } = deviceFixture();
  const snapshot = sessionSnapshot(deviceId);
  const session = snapshot.sessions[0]!;

  session.capabilities.userInput = true;
  session.status = SessionStatus.WaitingInput;
  snapshot.permissions = [];

  snapshot.userInputs = [{
    requestId: 'claude-question', sessionId: session.id, generation: session.generation,
    turnId: 'native-turn', itemId: 'native-tool-call', isBlocking: true, expiresAt: Date.now() + 120_000,
    questions: [{
      id: 'changes', header: 'Changes', question: 'Which synthetic checks should run?',
      isOther: true, isSecret: false, multiSelect: true,
      options: [{ label: 'Lint', description: 'Check source' }, { label: 'Tests', description: 'Run tests' }],
    }],
  }];

  sockets[0]!.send(JSON.stringify({ type: FrameType.Snapshot, snapshot, connectors: [] }));

  await identity(page, '801', 'en');
  await page.goto('/');
  await byTestId(page, SESSION_CARD_IDS.root, { 'session-id': session.id }).click();
  await byTestId(page, USER_INPUT_IDS.option, { 'question-id': 'changes', 'option-label': 'Lint' }).check();
  await byTestId(page, USER_INPUT_IDS.option, { 'question-id': 'changes', 'option-label': 'Tests' }).check();
  await expect(page.getByTestId(USER_INPUT_IDS.submit)).toBeEnabled();
  await page.getByTestId(USER_INPUT_IDS.submit).click();
  await expect.poll(() => delivered.length).toBe(1);

  expect(delivered[0]!.action).toEqual({
    type: CommandActionType.UserInput, requestId: 'claude-question',
    answers: { changes: { answers: ['Lint', 'Tests'] } },
  });

  // Native acknowledgement retires the question without inventing an idle state.
  snapshot.userInputs = [];
  session.status = SessionStatus.Running;
  sockets[0]!.send(JSON.stringify({ type: FrameType.Snapshot, snapshot, connectors: [] }));
  await expect(page.getByTestId(USER_INPUT_IDS.root)).toHaveCount(0);
  await expect(page.getByTestId(COMMAND_IDS.prompt)).toBeEnabled();
  await page.getByTestId(COMMAND_IDS.prompt).fill('Next synthetic instruction');
  await expect(page.getByTestId(COMMAND_IDS.send)).toBeEnabled();
});
