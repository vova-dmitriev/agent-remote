import { z } from 'zod';
import { MAX_RULE_PATTERNS, ReadyRule, RuleAction, RuleScopeKind } from './values.js';

const id = z.string().min(1).max(512);
const path = z.string().min(1).max(4096);
const text = z.string().trim().min(1).max(2000);
const command = z.string().min(1).max(16_384);

export const ruleSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(200),
  ready: z.enum(ReadyRule).nullable(),
  /** The owner's own words for an own rule. */
  sentence: text.nullable(),
  /** Case-insensitive regular expressions over the command text. */
  patterns: z.array(z.string().min(1).max(512)).min(1).max(MAX_RULE_PATTERNS),
});

export const ruleScopeSchema = z.strictObject({
  kind: z.enum(RuleScopeKind),
  /** The project's root path, or the session id. */
  key: z.union([path, id]),
});

const allowed = z.array(command).max(200);

export const rulesViewSchema = z.strictObject({
  projects: z
    .array(
      z.strictObject({
        root: path,
        label: z.string().min(1).max(512),
        rules: z.array(ruleSchema).max(100),
        allowed,
      }),
    )
    .max(100),
  session: z
    .strictObject({
      id,
      root: path,
      /** The session runs with bypass permissions: its project's rules do not apply, its own do. */
      bypass: z.boolean(),
      rules: z.array(ruleSchema).max(100),
      fromProject: z.array(ruleSchema).max(100),
      allowed,
    })
    .nullable(),
});

export const rulesRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal(RuleAction.View), sessionId: id.nullable() }),
  z.strictObject({
    action: z.literal(RuleAction.Toggle),
    scope: ruleScopeSchema,
    ready: z.enum(ReadyRule),
    on: z.boolean(),
  }),
  z.strictObject({ action: z.literal(RuleAction.Compile), sentence: text }),
  z.strictObject({
    action: z.literal(RuleAction.SaveOwn),
    scope: ruleScopeSchema,
    name: ruleSchema.shape.name,
    sentence: text,
    patterns: ruleSchema.shape.patterns,
  }),
  z.strictObject({ action: z.literal(RuleAction.Delete), scope: ruleScopeSchema, id }),
  z.strictObject({ action: z.literal(RuleAction.ForgetCommand), scope: ruleScopeSchema, command }),
]);

/** What a rule change answers: the rules after it, or a compiled draft for the owner to confirm. */
export const rulesReplySchema = z.union([
  rulesViewSchema,
  z.strictObject({ name: ruleSchema.shape.name, patterns: ruleSchema.shape.patterns }),
]);

/** The rule that stopped a command, on its permission request. */
export const permissionRuleSchema = z.strictObject({
  id,
  name: ruleSchema.shape.name,
  scope: z.enum(RuleScopeKind),
});

export type Rule = z.infer<typeof ruleSchema>;
export type RuleScope = z.infer<typeof ruleScopeSchema>;
export type RulesView = z.infer<typeof rulesViewSchema>;
export type RulesRequest = z.infer<typeof rulesRequestSchema>;
export type RulesReply = z.infer<typeof rulesReplySchema>;
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
