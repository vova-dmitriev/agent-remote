import { ErrorCode } from '../errors/error-codes.js';
import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));

export const userInputQuestionSchema = z.strictObject({
  id,
  header: z.string().max(512),
  question: z.string().min(1).max(16384),
  isOther: z.boolean(),
  isSecret: z.boolean(),
  multiSelect: z.boolean().optional(),
  options: z
    .array(z.strictObject({ label: z.string().min(1).max(1024), description: z.string().max(4096) }))
    .min(1)
    .max(20)
    .nullable(),
});
export const userInputAnswersSchema = z.preprocess(
  (value, context) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
    ) {
      context.addIssue({ code: 'custom', message: 'INVALID_USER_INPUT' });
    }

    return value;
  },
  z
    .record(id, z.strictObject({ answers: z.array(z.string().min(1).max(8192)).min(1).max(20) }))
    .refine((value) => Object.keys(value).length <= 4),
);
export const pendingUserInputSchema = z.strictObject({
  requestId: id,
  sessionId: id,
  generation: id,
  turnId: id,
  itemId: id,
  questions: z
    .array(userInputQuestionSchema)
    .min(1)
    .max(4)
    .refine((questions) => new Set(questions.map((question) => question.id)).size === questions.length),
  isBlocking: z.boolean(),
  expiresAt: z.number().int().nonnegative().safe(),
});
export type PendingUserInput = z.infer<typeof pendingUserInputSchema>;
export type UserInputQuestion = z.infer<typeof userInputQuestionSchema>;
export type UserInputAnswers = z.infer<typeof userInputAnswersSchema>;

export function validateUserInputAnswers(
  request: Pick<PendingUserInput, 'questions'>,
  raw: unknown,
): UserInputAnswers {
  const parsed = userInputAnswersSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(ErrorCode.INVALID_USER_INPUT);
  }

  const answers = parsed.data;
  const keys = Object.keys(answers);

  if (!keys.length) {
    return answers;
  }

  if (keys.length !== request.questions.length) {
    throw new Error(ErrorCode.INVALID_USER_INPUT);
  }

  for (const question of request.questions) {
    const values = Object.hasOwn(answers, question.id) ? answers[question.id]?.answers : undefined;

    if (
      !values?.length ||
      (!question.multiSelect && values.length !== 1) ||
      values.some((value) => !value.trim()) ||
      new Set(values).size !== values.length ||
      (question.options &&
        values.some((value) => !question.options!.some((option) => option.label === value)) &&
        !(
          question.isOther &&
          values.length === 1 &&
          !question.options.some((option) => option.label === values[0])
        ))
    ) {
      throw new Error(ErrorCode.INVALID_USER_INPUT);
    }
  }

  return answers;
}
