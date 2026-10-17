import { expect, it } from 'vitest';
import { validateUserInputAnswers } from '../packages/protocol/src/index.js';

const request = {
  questions: [
    {
      id: 'style',
      header: '',
      question: 'Pick a style',
      isOther: false,
      isSecret: false,
      options: [{ label: 'Dark', description: '' }],
    },
  ],
};

it('validates exact known choices and permits an explicit empty skip', () => {
  expect(validateUserInputAnswers(request, { style: { answers: ['Dark'] } })).toEqual({
    style: { answers: ['Dark'] },
  });

  expect(validateUserInputAnswers(request, {})).toEqual({});
});

it('rejects foreign questions, unknown choices, blank and multiple answers', () => {
  for (const answer of [
    { foreign: { answers: ['Dark'] } },
    { style: { answers: ['Light'] } },
    { style: { answers: ['  '] } },
    { style: { answers: ['Dark', 'Dark'] } },
  ]) {
    expect(() => validateUserInputAnswers(request, answer)).toThrow('INVALID_USER_INPUT');
  }
});

it('allows custom answers only for free-form questions and requires every question', () => {
  const custom = { questions: [{ ...request.questions[0]!, isOther: true }] };

  expect(validateUserInputAnswers(custom, { style: { answers: ['Custom style'] } })).toEqual({
    style: { answers: ['Custom style'] },
  });

  const free = { questions: [{ ...request.questions[0]!, options: null }] };

  expect(validateUserInputAnswers(free, { style: { answers: ['My text'] } })).toEqual({
    style: { answers: ['My text'] },
  });

  const multi = { questions: [...request.questions, { ...request.questions[0]!, id: 'other' }] };

  expect(() => validateUserInputAnswers(multi, { style: { answers: ['Dark'] } })).toThrow(
    'INVALID_USER_INPUT',
  );
});
