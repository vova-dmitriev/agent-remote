import { CodedError, errorCode, hasErrorCode } from '@protocol';
import { expect, it } from 'vitest';

it('keeps message equal to the code so message consumers keep working', () => {
  const cause = new Error('inner');
  const error = new CodedError('STALE_EPOCH', { cause });

  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('STALE_EPOCH');
  expect(error.code).toBe('STALE_EPOCH');
  expect(error.name).toBe('CodedError');
  expect(error.cause).toBe(cause);
});

it('reads codes only from CodedError instances', () => {
  expect(errorCode(new CodedError('A_B'))).toBe('A_B');
  expect(errorCode(new Error('A_B'))).toBeUndefined();
  expect(errorCode('A_B')).toBeUndefined();
  expect(hasErrorCode(new CodedError('A_B'), 'A_B')).toBe(true);
  expect(hasErrorCode(new CodedError('A_B'), 'C_D')).toBe(false);
  expect(hasErrorCode(undefined, 'A_B')).toBe(false);
});
