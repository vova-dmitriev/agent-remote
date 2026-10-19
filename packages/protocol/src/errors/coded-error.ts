export class CodedError<C extends string = string> extends Error {
  readonly code: C;

  constructor(code: C, options?: ErrorOptions) {
    super(code, options);
    this.name = 'CodedError';
    this.code = code;
  }
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof CodedError ? error.code : undefined;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return errorCode(error) === code;
}
