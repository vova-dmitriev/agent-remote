import { spawnSync } from 'node:child_process';

/** Set by the pre-commit hook: the staged paths, one per line. Unset (a manual `npm run validate`) runs every test. */
export const STAGED_PATHS_ENV = 'AGENT_REMOTE_STAGED_PATHS';

/** What the security tests exercise: the gates themselves, their rules and the hook that runs them. */
const SECURITY_INPUTS = [
  /^scripts\/security\//,
  /^scripts\/validation\//,
  /^\.semgrep\//,
  /^\.gitleaks/,
  /^\.githooks\//,
  /^package\.json$/,
];

/** Whether a commit of these paths can change what the security tests prove. */
export function needsSecurityTests(staged) {
  return (
    staged === undefined ||
    staged.split('\n').some((path) => SECURITY_INPUTS.some((input) => input.test(path)))
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!needsSecurityTests(process.env[STAGED_PATHS_ENV])) {
    // The staged secret and Semgrep scans still run in the hook; only the gates' own tests are skipped.
    process.stdout.write('Security tests skipped: the commit does not touch the security gates.\n');
  } else {
    const result = spawnSync(
      process.execPath,
      ['--test', 'scripts/security/check.test.mjs', 'scripts/validation/pre-commit.test.mjs'],
      { stdio: 'inherit' },
    );

    process.exitCode = result.status ?? 1;
  }
}
