// Findings of the vendored SecObserve ruleset that were reviewed and accepted live in semgrep-assessed.json (data
// only, mirrored in SECURITY.md). The gate reads that file from the tree under scan (the index in staged mode), never
// from an unstaged working copy. `# nosemgrep` is ignored (--disable-nosem), so each acceptance is keyed by rule id,
// path and a fingerprint of the matched code: SHA-256 prefix of the source lines Semgrep matched, whitespace-
// normalised, so it survives moves and re-indentation but not edits of those lines. Each entry accepts exactly one
// finding: a second finding of the same rule in the same file, even with identical code, is blocked.
import { createHash } from 'node:crypto';

export const ASSESSED_PATH = 'scripts/security/semgrep-assessed.json';

const FINGERPRINT = /^[0-9a-f]{16}$/;

export function parseAssessed(text) {
  if (text === undefined) {
    return [];
  }

  const entries = JSON.parse(text);

  const valid =
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        typeof entry?.ruleId === 'string' &&
        typeof entry.path === 'string' &&
        typeof entry.reason === 'string' &&
        entry.reason.trim().length > 0 &&
        FINGERPRINT.test(entry.fingerprint),
    );

  if (!valid) {
    throw new Error(
      `${ASSESSED_PATH} must list { ruleId, path, fingerprint, reason } entries. Scan did not run.`,
    );
  }

  return entries;
}

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
export function withoutAssessed(findings, assessed) {
  const allowance = countByKey(assessed);

  return findings.filter((finding) => {
    const left = allowance.get(keyOf(finding)) ?? 0;

    allowance.set(keyOf(finding), left - 1);

    return left <= 0;
  });
}

// Baseline scan: a new finding is accepted only if its rule, path and fingerprint occur in the scanned files
// (`scope`, all findings without baseline) no more often than they are assessed. Same verdict as a full scan.
export function newBeyondAssessed(newFindings, scope, assessed) {
  const allowance = countByKey(assessed);
  const occurrences = countByKey(scope);

  return newFindings.filter(
    (finding) => (occurrences.get(keyOf(finding)) ?? 0) > (allowance.get(keyOf(finding)) ?? 0),
  );
}
