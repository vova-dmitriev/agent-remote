import { relative, sep } from 'node:path';
import { ConsoleLogger } from '@nestjs/common';
import { expect } from 'vitest';

// Every relay a test starts would print Nest's lifecycle lines (module init, route mapping, startup) at `log` level.
// Tests that start a relay (under `tests/server/`, `tests/transport/` and `tests/integration/`) keep `error` and `warn`
// output and drop only those lines; mini-app tests are untouched, and the relay's production levels are unchanged.
const RELAY_TEST_AREAS = new Set(['server', 'transport', 'integration']);
const testPath = expect.getState().testPath;

const [rootSegment, areaSegment] = testPath ? relative(process.cwd(), testPath).split(sep) : [];

if (rootSegment === 'tests' && areaSegment !== undefined && RELAY_TEST_AREAS.has(areaSegment)) {
  ConsoleLogger.prototype.log = () => {};
}
