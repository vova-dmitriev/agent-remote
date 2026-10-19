import type { UserInputQuestion } from '@protocol';
import { object, type Data, type SyntheticThread } from './model.js';

export const styleQuestion: UserInputQuestion = {
  id: 'style', header: 'Style', question: '**Which style?**', isOther: true, isSecret: false,
  options: [{ label: 'Dark', description: 'Dark palette' }, { label: 'Light', description: 'Light palette' }],
};

export function syncQuestion(model: SyntheticThread, id: string, questions = [styleQuestion]) {
  const frame = { id, method: 'item/tool/requestUserInput', params: { threadId: model.threadId, turnId: model.active, itemId: id + '-item', questions, isBlocking: true, autoResolutionMs: null } };

  model.requests.push(frame);
  model.emit('approval', frame);
  model.emit('change');
}

export function asyncQuestion(model: SyntheticThread, id: string, title = "**Which style?**", options = ["Dark", "Light"]) {
  const item = { id, type: 'agentMessage', delivery: 'async', text: 'Which style?', questions: [{ title, options }] };

  (model.turns.at(-1)!.items as Data[]).push(item);
  model.emit('change');
}

export function localAsyncAnswer(model: SyntheticThread, itemId: string) {
  const text = '<send_user_message_question_reply>\n' + JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', itemId, 0]), question: '**Which style?**', answer: 'Dark' }]) + '\n</send_user_message_question_reply>';

  (model.turns.at(-1)!.items as Data[]).push({ id: 'local-reply', type: 'steeringUserMessage', status: 'accepted', input: [{ type: 'text', text }] });
  model.emit('change');
}

export function steeringReplies(model: SyntheticThread) {
  return model.frames.filter(frame => frame.method === 'thread-follower-steer-turn').map(frame => object(frame.params));
}
