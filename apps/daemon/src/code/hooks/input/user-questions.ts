import { z } from 'zod';
import { ClaudeHookDecision, ClaudeHookEvent } from '../../../domain/claude.js';

const questionOptionSchema = z.strictObject({
  label: z.string().min(1).max(1024),
  description: z.string().max(4096),
});

const questionSchema = z.strictObject({
  question: z.string().min(1).max(16384),
  header: z.string().max(512),
  options: z.array(questionOptionSchema).max(20).optional(),
  multiSelect: z.boolean().optional(),
});

export const claudeAskUserQuestionInputSchema = z.strictObject({
  questions: z.array(questionSchema).min(1).max(4),
});

export const CLAUDE_QUESTION_TIMEOUT_MS = 30 * 60_000;
const CLAUDE_QUESTION_DENIED_REASON = 'The user skipped this question.';

export function claudePendingQuestions(toolInput: unknown, requestId: string) {
  const parsed = claudeAskUserQuestionInputSchema.safeParse(toolInput);

  if (
    !parsed.success ||
    new Set(parsed.data.questions.map(({ question }) => question)).size !== parsed.data.questions.length ||
    parsed.data.questions.some(
      ({ options = [] }) => new Set(options.map(({ label }) => label)).size !== options.length,
    )
  ) {
    return undefined;
  }

  return parsed.data.questions.map((question, index) => {
    const options = question.options ?? [];

    return {
      id: `${requestId}:${index}`,
      header: question.header,
      question: question.question,
      isOther: true,
      isSecret: false,
      ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
      options: options.length ? options : null,
    };
  });
}

export function claudeQuestionHookOutput(
  toolInput: unknown,
  answers: Record<string, { answers: string[] }>,
  questions: readonly { id: string; question: string }[],
) {
  if (!Object.keys(answers).length) {
    return {
      hookSpecificOutput: {
        hookEventName: ClaudeHookEvent.PreToolUse,
        permissionDecision: ClaudeHookDecision.Deny,
        permissionDecisionReason: CLAUDE_QUESTION_DENIED_REASON,
      },
    };
  }

  const parsed = claudeAskUserQuestionInputSchema.parse(toolInput);

  const answerEntries = questions.map(
    ({ id, question }) => [question, answers[id]!.answers.join(', ')] as const,
  );

  return {
    hookSpecificOutput: {
      hookEventName: ClaudeHookEvent.PreToolUse,
      permissionDecision: ClaudeHookDecision.Allow,
      updatedInput: {
        questions: parsed.questions,
        answers: Object.fromEntries(answerEntries),
      },
    },
  };
}
