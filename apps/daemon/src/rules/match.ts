import { isAbsolute, relative, resolve } from 'node:path';
import { ReadyRule, RuleScopeKind, type Rule, type RuleScope } from '@protocol';
import { logDebug } from '../diagnostics/log.js';
import { readyRule } from './ready-rules.js';
import type { RulesFile, ScopeRules } from './store.js';

export interface RuleInForce {
  rule: Rule;
  scope: RuleScope;
}

interface SessionContext {
  sessionId: string;
  root: string;
  /** The agent runs without asking: its project's rules stay silent, its session's rules apply. */
  bypass: boolean;
}

const expand = (rules: ScopeRules | undefined, scope: RuleScope): RuleInForce[] =>
  rules ? [...rules.ready.map(readyRule), ...rules.own].map((rule) => ({ rule, scope })) : [];

export function rulesInForce(file: RulesFile, context: SessionContext): RuleInForce[] {
  const session = expand(file.sessions[context.sessionId], {
    kind: RuleScopeKind.Session,
    key: context.sessionId,
  });

  return context.bypass
    ? session
    : [
        ...session,
        ...expand(file.projects[context.root], { kind: RuleScopeKind.Project, key: context.root }),
      ];
}

const pattern = (source: string) => {
  try {
    return new RegExp(source, 'iu');
  } catch (error) {
    logDebug('rules/match', error);

    return undefined;
  }
};

/** Whether `rm -rf` names a path outside the project: absolute elsewhere, `~`, or climbing out with `..`. */
function removesOutside(command: string, root: string) {
  const targets = command.split(/[;&|]/u).flatMap((part) => {
    const words = part.trim().split(/\s+/u);

    return words[0] === 'rm' ? words.slice(1).filter((word) => !word.startsWith('-')) : [];
  });

  return targets.some((target) => {
    const path = target.replace(/^["']|["']$/gu, '');
    const away = relative(root, resolve(root, path));

    return path.startsWith('~') || away.startsWith('..') || isAbsolute(away);
  });
}

const scopeOf = (file: RulesFile, scope: RuleScope) =>
  scope.kind === RuleScopeKind.Session ? file.sessions[scope.key] : file.projects[scope.key];

/** The first rule in force the command matches, unless the owner allowed this exact command on that rule's scope. */
export function matchCommand(
  command: string,
  inForce: readonly RuleInForce[],
  file: RulesFile,
  root: string,
) {
  return (
    inForce.find(({ rule, scope }) => {
      if (scopeOf(file, scope)?.allowed.includes(command)) {
        return false;
      }

      const matched = rule.patterns.some((source) => pattern(source)?.test(command));

      return matched && (rule.ready !== ReadyRule.RemoveOutsideProject || removesOutside(command, root));
    }) ?? null
  );
}
