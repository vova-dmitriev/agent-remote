import type { LocalDatabase } from '../../../local/state/database.js';
import type { ProfileScope } from '../../types.js';
import {
  ExecutionChildState,
  ExecutionOwnershipKind,
  TerminalProfileOperationPhases,
  type ExecutionChildState as ChildState,
  type ExecutionOwnershipKind as OwnershipKind,
} from './execution-values.js';

interface OwnershipRow {
  ref: string;
  profile: string;
  kind: OwnershipKind;
  operation: string | null;
  socket: string | null;
  pid: number | null;
  ready: number;
}

export async function reconcileExecutionReferences(
  database: LocalDatabase,
  scope: ProfileScope,
  probe: (pid: number) => Promise<ChildState>,
  release: (id: string) => boolean,
) {
  const rows = database.connection
    .prepare(
      'SELECT ref,profile,kind,operation,socket,pid,ready FROM profile_execution_refs WHERE owner=? AND device=?',
    )
    .all(scope.ownerId, scope.deviceId) as OwnershipRow[];

  for (const row of rows) {
    if (row.kind === ExecutionOwnershipKind.Mutation) {
      if (row.operation) {
        const phase = database.connection
          .prepare(
            "SELECT json_extract(value,'$.phase') AS phase FROM profile_operations WHERE owner=? AND device=? AND id=?",
          )
          .get(scope.ownerId, scope.deviceId, row.operation) as { phase: string } | undefined;

        if (
          phase &&
          TerminalProfileOperationPhases.includes(
            phase.phase as (typeof TerminalProfileOperationPhases)[number],
          )
        ) {
          release(row.ref);
        }
      }

      continue;
    }

    if (row.pid && (await probe(row.pid)) === ExecutionChildState.Exited) {
      release(row.ref);
    }
  }
}
