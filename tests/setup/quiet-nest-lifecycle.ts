import { ConsoleLogger } from '@nestjs/common';

// Every relay a test starts would print Nest's lifecycle lines (module init, route mapping, startup) at `log` level.
// Tests keep `error` and `warn` output and drop only those lines; the relay's production levels are unchanged.
ConsoleLogger.prototype.log = () => {};
