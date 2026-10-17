import {
  CodexSteeringStatus,
  CodexItemType,
  CodexTurnStatus,
  CodexContentType,
  CodexMethod,
} from '../domain/codex.js';
import { object, type Data } from './events.js';
import { userInputQuestionSchema } from '../../../../packages/protocol/src/index.js';

const OPEN = '<send_user_message_question_reply>',
  CLOSE = '</send_user_message_question_reply>';

/** Accepted steering messages and canonical user items are the native async reply receipt. */
export function asyncReplyKeys(items: unknown[]): Set<string> {
  const answered = new Set<string>();

  for (const raw of items) {
    const item = object(raw);

    if (
      item.type !== CodexItemType.UserMessage &&
      !(item.type === CodexItemType.SteeringUserMessage && item.status === CodexSteeringStatus.Accepted)
    ) {
      continue;
    }

    const content = item.type === CodexItemType.UserMessage ? item.content : item.input;

    if (!Array.isArray(content) || content.length !== 1) {
      continue;
    }

    const part = object(content[0]);

    if (part.type !== CodexContentType.Text || typeof part.text !== 'string') {
      continue;
    }

    const text = part.text.trim();

    if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) {
      continue;
    }

    try {
      const entries: unknown = JSON.parse(text.slice(OPEN.length, -CLOSE.length).trim());

      for (const entry of (Array.isArray(entries) ? entries : [entries]).slice(0, 100)) {
        const value = object(entry);

        if (
          typeof value.questionItemId === 'string' &&
          typeof value.question === 'string' &&
          typeof value.answer === 'string'
        ) {
          answered.add(JSON.stringify([value.questionItemId, value.question, value.answer]));
        }
      }
    } catch {}
  }

  return answered;
}

export function asyncReplyIds(items: unknown[]): Set<string> {
  return new Set([...asyncReplyKeys(items)].map((key) => (JSON.parse(key) as string[])[0]!));
}

export function desktopAsyncRequests(turns: Data[]): Data[] {
  const turn = turns.findLast((value) => value.status === CodexTurnStatus.InProgress);

  if (!turn || typeof turn.id !== 'string') {
    return [];
  }

  const items: unknown[] = Array.isArray(turn.items) ? turn.items : [];

  const answered = asyncReplyIds(items),
    requests: Data[] = [];

  for (const raw of items) {
    const item = object(raw);

    if (
      item.type !== CodexItemType.AgentMessage ||
      typeof item.id !== 'string' ||
      !Array.isArray(item.questions)
    ) {
      continue;
    }

    for (const [index, rawQuestion] of item.questions.slice(0, 100).entries()) {
      const input = object(rawQuestion),
        id = JSON.stringify(['request_user_input_async', item.id, index]);

      if (answered.has(id)) {
        continue;
      }

      const options =
        Array.isArray(input.options) && input.options.length
          ? input.options.map((label) => ({ label, description: '' }))
          : null;

      const question = userInputQuestionSchema.safeParse({
        id,
        header: 'Question',
        question: input.title,
        isOther: true,
        isSecret: false,
        options,
      });

      if (!question.success) {
        continue;
      }

      requests.push({
        id,
        method: CodexMethod.ItemToolRequestUserInput,
        params: { turnId: turn.id, itemId: item.id, isBlocking: false, questions: [question.data] },
      });
    }
  }

  return requests;
}

export function asyncReplyWrapper(
  answers: { questionItemId: string; question: string; answer: string }[],
): string {
  return `${OPEN}\n${JSON.stringify(answers).replaceAll('<', '\\u003c')}\n${CLOSE}`;
}
