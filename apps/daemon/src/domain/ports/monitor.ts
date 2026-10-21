import type { EventEmitter } from 'node:events';
import {
  type AgentModel,
  type AgentProvider,
  type AppSnapshot,
  type EventEnvelope,
  type PermissionDecision,
  type Session,
  sessionSchema,
  type Target,
} from '@protocol';
import { z } from 'zod';
import type { ModelOrigin } from '../runtime.js';
import type { Binding } from './binding.js';
import type { NativeSessionRegistration } from './local-store.js';

export const hookSchema = z.object({
  hook_event_name: z.string().min(1).max(128),
  session_id: z.string().min(1).max(512),
  transcript_path: z.string().max(4096).optional(),
  source: z.string().max(128).optional(),
  model: sessionSchema.shape.model.optional(),
  cwd: sessionSchema.shape.cwd.optional(),
  agent_id: z.string().min(1).max(512).optional(),
  agent_type: z.string().max(512).optional(),
  tool_use_id: z.string().min(1).max(512).optional(),
  tool_name: z.string().max(512).optional(),
  tool_input: z.unknown().optional(),
  /** Claude Code's permission mode for this session, e.g. `bypassPermissions`. */
  permission_mode: sessionSchema.shape.permissionMode.optional(),
});
export type HookEnvelope = z.infer<typeof hookSchema>;

/** Session state owned by the monitor, as seen by the modules that feed it. */
export interface MonitorPort extends EventEmitter {
  session(id: string): Session | undefined;
  binding(id: string): Binding | undefined;
  snapshot(): AppSnapshot;
  publish(sessionId: string | null, type: string, payload: unknown, occurredAt?: number): EventEnvelope;
  ingestHook(
    raw: HookEnvelope,
    connectorId: string,
    targetOverride?: Target,
    options?: { verifiedTerminal?: boolean },
  ): EventEnvelope[];
  managedRegistration(
    connectorId: string,
    cmux?: { windowId: string; workspaceId: string; surfaceId: string },
  ): NativeSessionRegistration | undefined;
  restoreManaged(saved: Session): void;
  findClaude(connectorId: string, claudeSessionId: string): Session | undefined;
  addDesktop(session: Session, binding: Binding): void;
  invalidate(connectorId: string): void;
  setSessionTitle(id: string, title: string | undefined): boolean;
  setPinned(id: string, pinned: boolean): boolean;
  hide(id: string, at?: number): boolean;
  setProviderModels(provider: AgentProvider, models: AgentModel[]): void;
  setSubagents(id: string, agents: Session['subagents']): void;
  settleSubagentPermission(sessionId: string, agentId: string, decision: PermissionDecision): void;
  setSessionModel(
    id: string,
    model: unknown,
    origin?: typeof ModelOrigin.Native | typeof ModelOrigin.Transcript,
    expectedNativeRevision?: number,
  ): boolean;
}
