// Findings of the vendored SecObserve ruleset that were reviewed and accepted, mirrored in SECURITY.md.
// `# nosemgrep` is ignored by the gate (--disable-nosem), so each acceptance is keyed here by rule id, path and
// a fingerprint of the matched code: SHA-256 prefix of the source lines Semgrep matched, whitespace-normalised, so
// it survives moves and re-indentation but not edits. Each entry accepts exactly one finding: a second finding of
// the same rule in the same file, even with identical code, is blocked.
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

const keyOf = ({ ruleId, path, fingerprint }) => JSON.stringify([ruleId, path, fingerprint]);

function countByKey(items) {
  const counts = new Map();

  for (const item of items) {
    counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  }

  return counts;
}

// Full scan: each assessed entry absorbs one matching finding; the rest are reported.
export function withoutAssessed(findings) {
  const allowance = countByKey(assessedFindings);

  return findings.filter((finding) => {
    const left = allowance.get(keyOf(finding)) ?? 0;

    allowance.set(keyOf(finding), left - 1);

    return left <= 0;
  });
}

// Baseline scan: a new finding is accepted only if its rule, path and fingerprint occur in the scanned files
// (`scope`, all findings without baseline) no more often than they are assessed. Same verdict as a full scan.
export function newBeyondAssessed(newFindings, scope) {
  const allowance = countByKey(assessedFindings);
  const occurrences = countByKey(scope);

  return newFindings.filter(
    (finding) => (occurrences.get(keyOf(finding)) ?? 0) > (allowance.get(keyOf(finding)) ?? 0),
  );
}
