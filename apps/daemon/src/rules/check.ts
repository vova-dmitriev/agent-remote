import { randomUUID } from 'node:crypto';
import {
  EventType,
  PermissionDecision,
  RULE_ANSWER_TIMEOUT_MS,
  RuleScopeKind,
  type Rule,
  type Session,
} from '@protocol';
import type { PermissionBroker } from '../commands/permission-broker.js';
import { ClaudeHookEvent, ClaudePermissionMode, ClaudeShellTool } from '../domain/claude.js';
import { CodexShellTool } from '../domain/codex/codex.js';
import { HookAgent } from '../domain/ipc.js';
import type { HookEnvelope } from '../domain/ports/monitor.js';
import { matchCommand, rulesInForce, type RuleInForce } from './matching/match.js';
import { projectRoot } from './matching/project.js';
import { emptyScope, type RulesStore } from './store.js';

/** Tools whose input is a shell command. */
const SHELL_TOOLS: ReadonlySet<string> = new Set([ClaudeShellTool, CodexShellTool]);

interface RuleGuardDeps {
  store: RulesStore;
  permissions: PermissionBroker;
  monitor: { publish(sessionId: string | null, type: string, payload: unknown): unknown };
  /** The project a working directory belongs to; the git root by default. */
  root?: (cwd: string) => Promise<string>;
}

export interface RuleStop extends RuleInForce {
  command: string;
  root: string;
}

const commandOf = (hook: Pick<HookEnvelope, 'tool_name' | 'tool_input'>) => {
  const input = hook.tool_input as { command?: unknown; cmd?: unknown } | undefined;
  // Claude's Bash takes `command`; Codex's exec_command takes `cmd`.
  const command = input?.command ?? input?.cmd;

  return SHELL_TOOLS.has(hook.tool_name ?? '') && typeof command === 'string' ? command : undefined;
};

/** Stops a shell command an owner's rule covers until the owner answers it, in the app or Telegram. */
export class RuleGuard {
  constructor(private readonly deps: RuleGuardDeps) {}

  async check(
    hook: Pick<HookEnvelope, 'tool_name' | 'tool_input' | 'permission_mode' | 'cwd'>,
    session: Session,
  ) {
    const command = commandOf(hook);
    const cwd = session.cwd ?? hook.cwd;

    if (!command || !cwd) {
      return null;
    }

    const root = await (this.deps.root ?? projectRoot)(cwd);
    const rules = this.deps.store.read();
    const bypass = hook.permission_mode === ClaudePermissionMode.Bypass;

    const match = matchCommand(
      command,
      rulesInForce(rules, { sessionId: session.id, root, bypass }),
      rules,
      root,
    );

    return match ? { ...match, command, root } : null;
  }

  /** Asks the owner; an allow-always is remembered on the rule's scope before it is returned. */
  async ask(stop: RuleStop, hook: Pick<HookEnvelope, 'tool_name' | 'tool_input'>, session: Session) {
    const rule = { id: stop.rule.id, name: stop.rule.name, scope: stop.scope.kind };
    const requestId = randomUUID();

    const answer = this.deps.permissions.open({
      requestId,
      sessionId: session.id,
      generation: session.generation,
      toolName: hook.tool_name ?? ClaudeShellTool,
      input: hook.tool_input ?? {},
      expiresAt: Date.now() + RULE_ANSWER_TIMEOUT_MS,
      rule,
    });

    this.deps.monitor.publish(session.id, EventType.Permission, {
      status: session.status,
      rule,
      command: stop.command,
      // Telegram's answer buttons send the decision for exactly this request.
      requestId,
      generation: session.generation,
    });

    const decision = await answer;

    if (decision === PermissionDecision.AllowAlways) {
      this.deps.store.update((rules) => {
        const scopes = stop.scope.kind === RuleScopeKind.Session ? rules.sessions : rules.projects;
        const scope = (scopes[stop.scope.key] ??= emptyScope());

        scope.allowed = [...new Set([...scope.allowed, stop.command])];
      });
    }

    return decision;
  }
}

/**
 * The PreToolUse answer: allow, or deny with the rule's name and why. Codex rejects an explicit allow, so its allow
 * is no output (the daemon marks the reply settled so it still wins over another daemon).
 */
export function ruleHookOutput(
  decision: string,
  rule: Pick<Rule, 'name'>,
  agent: HookAgent = HookAgent.Claude,
) {
  const allowed = decision === PermissionDecision.Allow || decision === PermissionDecision.AllowAlways;
  const why = decision === PermissionDecision.Deny ? 'denied by the owner' : 'no answer in 10 minutes';

  if (allowed && agent === HookAgent.Codex) {
    return {};
  }

  return {
    hookSpecificOutput: allowed
      ? { hookEventName: ClaudeHookEvent.PreToolUse, permissionDecision: PermissionDecision.Allow }
      : {
          hookEventName: ClaudeHookEvent.PreToolUse,
          permissionDecision: PermissionDecision.Deny,
          permissionDecisionReason: `Agent Remote rule «${rule.name}»: ${why}`,
        },
  };
}
