import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ReadyRule, ruleSchema } from '@protocol';
import { z } from 'zod';
import { defaultStateDirectory } from '../config.js';
import { logDebug } from '../diagnostics/log.js';

const scopeRulesSchema = z.strictObject({
  ready: z.array(z.enum(ReadyRule)).max(20),
  own: z.array(ruleSchema).max(100),
  /** Exact commands the owner chose to allow always. */
  allowed: z.array(z.string().min(1).max(16_384)).max(200),
});

const rulesFileSchema = z.strictObject({
  version: z.literal(1),
  projects: z.record(z.string(), scopeRulesSchema),
  sessions: z.record(z.string(), scopeRulesSchema),
});

export type ScopeRules = z.infer<typeof scopeRulesSchema>;
export type RulesFile = z.infer<typeof rulesFileSchema>;

/** One file for every daemon of this OS user: the CLI daemon and a desktop companion see the same rules. */
export const RULES_FILE = () => join(defaultStateDirectory(), 'rules.json');

export const emptyRules = (): RulesFile => ({ version: 1, projects: {}, sessions: {} });

export const emptyScope = (): ScopeRules => ({ ready: [], own: [], allowed: [] });

export class RulesStore {
  constructor(private readonly path = RULES_FILE()) {}

  read(): RulesFile {
    try {
      return rulesFileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
    } catch (error) {
      logDebug('rules/store', error);

      return emptyRules();
    }
  }

  /** Re-reads the file, applies the change and replaces the file whole, so another daemon's change is kept. */
  update(change: (rules: RulesFile) => void): RulesFile {
    const rules = this.read();

    change(rules);

    const parsed = rulesFileSchema.parse(rules);
    const temporary = `${this.path}.${randomUUID()}`;

    writeFileSync(temporary, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);

    return parsed;
  }
}
