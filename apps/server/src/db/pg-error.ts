/** PostgreSQL SQLSTATE codes the relay reacts to. */
export const PgErrorCode = {
  UniqueViolation: '23505',
  ForeignKeyViolation: '23503',
} as const;

export type PgErrorCode = (typeof PgErrorCode)[keyof typeof PgErrorCode];

/**
 * The SQLSTATE of a failed query. The query builder wraps the driver's error and keeps it as `cause`, so the code is
 * read from the error itself or from its cause.
 */
export function postgresCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 2; depth++) {
    const code = (current as { code?: unknown }).code;

    if (typeof code === 'string') {
      return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
