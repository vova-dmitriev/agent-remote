export const SESSION_SKILLS_LIMIT = {
  maxCount: 200,
  maxNameLength: 128,
  maxDescriptionLength: 1000,
} as const;

export const SKILL_INVOCATION_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
