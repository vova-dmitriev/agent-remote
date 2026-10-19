// Findings of the vendored SecObserve ruleset that were reviewed and accepted.
// `# nosemgrep` is ignored by the gate (--disable-nosem), so each acceptance is keyed by rule and path
// here, with a fingerprint of the matched lines (whitespace-normalised SHA-256 prefix), and mirrored in SECURITY.md. A second finding of the same rule in the same file has another fingerprint and is blocked.
import { createHash } from 'node:crypto';

export const SemgrepRule = Object.freeze({
  NodeSsrf: 'rules_lgpl_javascript_ssrf_rule-node-ssrf',
});

export const assessedFindings = Object.freeze([
  {
    ruleId: SemgrepRule.NodeSsrf,
    path: 'apps/daemon/src/cli/pairing/connect.ts',
    fingerprint: 'e6c8ce22eea6788b',
    reason:
      'Relay origin is checked by validateRelayUrl before any request; the daemon only calls its own configured relay.',
  },
  {
    ruleId: SemgrepRule.NodeSsrf,
    path: 'apps/mini-app/src/shared/api/request-error.ts',
    fingerprint: '8d5f671da54f3ac3',
    reason:
      'Browser fetch to the app API origin from build configuration; no server-side network position to abuse.',
  },
  {
    ruleId: SemgrepRule.NodeSsrf,
    path: 'scripts/smoke-image.ts',
    fingerprint: 'da9fecb8b7f344df',
    reason: 'Developer smoke script requesting a loopback container port it started itself.',
  },
]);

export function fingerprint(source, startLine, endLine) {
  const matched = source
    .split('\n')
    .slice(startLine - 1, endLine)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  return createHash('sha256').update(matched).digest('hex').slice(0, 16);
}

export function isAssessed(finding) {
  return assessedFindings.some(
    (entry) =>
      entry.ruleId === finding.ruleId &&
      entry.path === finding.path &&
      entry.fingerprint === finding.fingerprint,
  );
}
