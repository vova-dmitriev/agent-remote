import { z } from 'zod';
import { SESSION_SKILLS_LIMIT, SKILL_INVOCATION_PATTERN } from './values.js';

const id = z.string().trim().min(1).max(512);

export const sessionSkillSchema = z.strictObject({
  name: z.string().trim().min(1).max(SESSION_SKILLS_LIMIT.maxNameLength),
  description: z.string().trim().min(1).max(SESSION_SKILLS_LIMIT.maxDescriptionLength),
  invocation: z.string().regex(SKILL_INVOCATION_PATTERN),
});

export const sessionSkillsSchema = z.strictObject({
  sessionId: id,
  generation: id,
  supported: z.boolean(),
  truncated: z.boolean().default(false),
  skills: z.array(sessionSkillSchema).max(SESSION_SKILLS_LIMIT.maxCount),
});

export type SessionSkill = z.infer<typeof sessionSkillSchema>;
export type SessionSkills = z.infer<typeof sessionSkillsSchema>;
