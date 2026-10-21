import { ReadyRule, type Rule } from '@protocol';

/** Statements that change or remove data with no row filter: `delete from t`, `update t set …` without `where`. */
const UNFILTERED = String.raw`(?![^;"']*\bwhere\b)`;

const READY: Record<ReadyRule, { name: string; patterns: string[] }> = {
  [ReadyRule.Database]: {
    name: 'Suspicious database queries',
    patterns: [
      String.raw`\bdrop\s+(table|database|schema|view|index)\b`,
      String.raw`\btruncate\b`,
      String.raw`\bdelete\s+from\s+[\w."]+${UNFILTERED}`,
      String.raw`\bupdate\s+[\w."]+\s+set\b${UNFILTERED}`,
    ],
  },
  // The target check lives in `match.ts`: only paths outside the project stop.
  [ReadyRule.RemoveOutsideProject]: {
    name: 'rm -rf outside the project',
    patterns: [String.raw`\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*|-r\s+-f|-f\s+-r)\s`],
  },
  [ReadyRule.ForcePush]: {
    name: 'git push --force',
    patterns: [String.raw`\bgit\s+push\b[^;&|]*\s(--force(-with-lease)?|-f)\b`],
  },
  [ReadyRule.DeployMigrations]: {
    name: 'Deploys and migrations',
    patterns: [
      String.raw`\b(kubectl\s+(apply|delete)|helm\s+(upgrade|install|uninstall)|terraform\s+(apply|destroy))\b`,
      String.raw`\b(fly\s+deploy|vercel\s+(deploy|--prod)|npm\s+run\s+(deploy|migrate)[\w:-]*)\b`,
      String.raw`\b(drizzle-kit\s+(push|migrate)|prisma\s+migrate\s+deploy|alembic\s+upgrade|rails\s+db:migrate)\b`,
    ],
  },
  [ReadyRule.Secrets]: {
    name: 'Changes to .env and secrets',
    patterns: [
      String.raw`(>|\btee\b|\bsed\s+-i\b|\bmv\b|\bcp\b|\brm\b)[^;&|]*\.env\b`,
      String.raw`\bsecurity\s+(add|delete|set)-\w*password\b`,
    ],
  },
};

export const readyRule = (ready: ReadyRule): Rule => ({
  id: `ready-${ready}`,
  name: READY[ready].name,
  ready,
  sentence: null,
  patterns: READY[ready].patterns,
});
