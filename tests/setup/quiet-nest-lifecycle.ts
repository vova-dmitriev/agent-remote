import { relative, sep } from 'node:path';
import { ConsoleLogger } from '@nestjs/common';
import { expect } from 'vitest';

// Every relay a test starts would print Nest's lifecycle lines (module init, route mapping, startup) at `log` level.
// Server tests (under `tests/`) keep `error` and `warn` output and drop only those lines; mini-app tests are untouched,
// and the relay's production levels are unchanged.
const testPath = expect.getState().testPath;

if (testPath && relative(process.cwd(), testPath).split(sep)[0] === 'tests') {
  ConsoleLogger.prototype.log = () => {};
}
