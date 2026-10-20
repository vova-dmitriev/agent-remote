import { bigint, customType } from 'drizzle-orm/pg-core';

/** Epoch milliseconds stored as `bigint`; read as a JS number (all values fit in 2^53). */
export const epoch = (name: string) => bigint(name, { mode: 'number' });

/** Raw bytes (`bytea`), read and written as a Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
