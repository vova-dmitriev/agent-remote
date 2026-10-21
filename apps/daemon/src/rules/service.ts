import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
  RuleAction,
  RuleScopeKind,
  type AppSnapshot,
  type RuleScope,
  type RulesReply,
  type RulesRequest,
  type RulesView,
} from '@protocol';
import { ClaudePermissionMode } from '../domain/claude.js';
import { compileRule } from './compile.js';
import { projectRoot } from './matching/project.js';
import { readyRule } from './matching/ready-rules.js';
import { emptyScope, type RulesFile, type RulesStore, type ScopeRules } from './store.js';

/** What the app's surfaces ask of the rules: a view, or a change answered with the view after it. */
export interface RulesPort {
  apply(request: RulesRequest): Promise<RulesReply>;
}

interface RulesServiceDeps {
  store: RulesStore;
  monitor: { snapshot(): AppSnapshot };
  root?: (cwd: string) => Promise<string>;
  compile?: (sentence: string) => Promise<{ name: string; patterns: string[] }>;
}

const rulesOf = (scope: ScopeRules | undefined) =>
  scope ? [...scope.ready.map(readyRule), ...scope.own] : [];

const scopes = (file: RulesFile, scope: RuleScope) =>
  scope.kind === RuleScopeKind.Session ? file.sessions : file.projects;

/** The owner's rules on this Mac: listed per project and session, and changed from the app. */
export class RulesService implements RulesPort {
  constructor(private readonly deps: RulesServiceDeps) {}

  async apply(request: RulesRequest): Promise<RulesReply> {
    if (request.action === RuleAction.View) {
      return this.view(request.sessionId);
    }

    if (request.action === RuleAction.Compile) {
      return (this.deps.compile ?? compileRule)(request.sentence);
    }

    this.deps.store.update((file) => {
      const scope = (scopes(file, request.scope)[request.scope.key] ??= emptyScope());

      if (request.action === RuleAction.Toggle) {
        scope.ready = request.on
          ? [...new Set([...scope.ready, request.ready])]
          : scope.ready.filter((ready) => ready !== request.ready);
      } else if (request.action === RuleAction.SaveOwn) {
        const { name, sentence, patterns } = request;

        scope.own = [...scope.own, { id: randomUUID(), name, ready: null, sentence, patterns }];
      } else if (request.action === RuleAction.Delete) {
        scope.own = scope.own.filter((rule) => rule.id !== request.id);
      } else {
        scope.allowed = scope.allowed.filter((command) => command !== request.command);
      }
    });

    return this.view(request.scope.kind === RuleScopeKind.Session ? request.scope.key : null);
  }

  /** Every project the device's sessions work in or that has rules, and the given session's rules. */
  async view(sessionId: string | null): Promise<RulesView> {
    const file = this.deps.store.read();
    const root = this.deps.root ?? projectRoot;
    const sessions = this.deps.monitor.snapshot().sessions;
    const roots = new Map<string, string>();

    for (const session of sessions) {
      if (session.cwd) {
        roots.set(session.id, await root(session.cwd));
      }
    }

    const projects = [...new Set([...roots.values(), ...Object.keys(file.projects)])].sort();
    const session = sessions.find((item) => item.id === sessionId);
    const sessionRoot = session && roots.get(session.id);

    return {
      projects: projects.map((path) => ({
        root: path,
        label: basename(path) || path,
        rules: rulesOf(file.projects[path]),
        allowed: file.projects[path]?.allowed ?? [],
      })),
      session:
        session && sessionRoot
          ? {
              id: session.id,
              root: sessionRoot,
              bypass: session.permissionMode === ClaudePermissionMode.Bypass,
              rules: rulesOf(file.sessions[session.id]),
              fromProject: rulesOf(file.projects[sessionRoot]),
              allowed: file.sessions[session.id]?.allowed ?? [],
            }
          : null,
    };
  }
}
