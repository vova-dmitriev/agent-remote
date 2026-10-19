import { sameFence } from '../context/values.js';
import type { CheckpointSource, CheckpointMessage, SourceFence } from '../context/types.js';
import { probeRepository } from './repository.js';
import type { NativeCheckpointSourceOptions, RepositoryProbe } from './types.js';
import { CheckpointSourceError, hasControlCharacter, sourceFailure } from './values.js';
import {
  BindingState,
  ConnectorId,
  IntegrationState,
  MessageRole,
  SessionStatus,
  SubagentStatus,
  type AttachmentDescriptor,
  type Session,
} from '@protocol';
import { nativeFile } from '../../attachments/io.js';
import { isAbsolute } from 'node:path';

const completedSubagents = new Set<string>([
  SubagentStatus.Completed,
  SubagentStatus.Failed,
  SubagentStatus.Stopped,
]);

export function validateSession(
  options: NativeCheckpointSourceOptions,
  expectedKinds: readonly string[],
): Session {
  const session = options.currentSession();

  if (
    !session ||
    session.id !== options.sessionId ||
    session.generation !== options.generation ||
    session.target.deviceId !== options.deviceId ||
    !expectedKinds.includes(session.target.kind) ||
    session.target.connectorId !== ConnectorId.Native ||
    session.binding !== BindingState.Verified ||
    session.integrationState !== IntegrationState.Ready ||
    !session.capabilities.observe ||
    !session.capabilities.history ||
    !session.cwd ||
    !isAbsolute(session.cwd) ||
    hasControlCharacter(session.cwd)
  ) {
    throw sourceFailure(CheckpointSourceError.BindingInvalid);
  }

  if (
    session.status !== SessionStatus.Idle ||
    session.currentActivity ||
    session.subagents?.some((agent) => !completedSubagents.has(agent.status))
  ) {
    throw sourceFailure(CheckpointSourceError.Busy);
  }

  return session;
}

export function mapMessage(
  message: import('@protocol').HistoryMessage,
  attachments: Map<string, AttachmentDescriptor>,
): CheckpointMessage | null {
  if (message.role !== MessageRole.User && message.role !== MessageRole.Assistant) {
    return null;
  }

  const references = (message.attachments ?? []).map((descriptor) => {
    const previous = attachments.get(descriptor.id);

    if (previous && JSON.stringify(previous) !== JSON.stringify(descriptor)) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    attachments.set(descriptor.id, descriptor);

    if (attachments.size > 1024) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    return { id: descriptor.id, path: descriptor.id };
  });

  return { id: message.id, role: message.role, visible: true, text: message.text, attachments: references };
}

export function sourceBase(
  options: NativeCheckpointSourceOptions,
  expectedKinds: readonly string[],
  historyWatermark: (session: Session) => Promise<string>,
): {
  source: CheckpointSource;
  attachments: Map<string, AttachmentDescriptor>;
  validate(): Session;
} {
  const attached = new Map<string, AttachmentDescriptor>();
  const repository: RepositoryProbe = options.repositoryProbe ?? probeRepository;
  const boundCwd = validateSession(options, expectedKinds).cwd;

  const validate = () => {
    const session = validateSession(options, expectedKinds);

    if (session.cwd !== boundCwd) {
      throw sourceFailure(CheckpointSourceError.BindingInvalid);
    }

    return session;
  };

  const captureFence = async (): Promise<SourceFence> => {
    const session = validate();
    const [repo, watermark] = await Promise.all([repository(session.cwd!), historyWatermark(session)]);

    validate();

    return {
      ownerId: options.ownerId,
      deviceId: options.deviceId,
      executionId: options.executionId,
      generation: options.generation,
      historyWatermark: watermark,
      repositoryRevision: repo.revision,
      workingTree: repo.workingTree,
    };
  };

  const readAttachment = async (reference: { id: string; path: string }, maxBytes: number) => {
    const initial = await captureFence();
    const descriptor = attached.get(reference.id);
    const session = validate();

    if (!descriptor || reference.path !== reference.id) {
      throw sourceFailure(CheckpointSourceError.AttachmentUnavailable);
    }

    const files = await options.attachments.prepare(session, [descriptor]);
    const prepared = files[0];

    if (!prepared || prepared.descriptor.id !== reference.id) {
      throw sourceFailure(CheckpointSourceError.AttachmentUnavailable);
    }

    if (!sameFence(initial, await captureFence())) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    const bytes = await nativeFile(prepared.path);

    if (bytes.byteLength > maxBytes) {
      throw sourceFailure(CheckpointSourceError.AttachmentSizeLimit);
    }

    const current = await captureFence();

    if (!sameFence(initial, current)) {
      throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
    }

    return bytes;
  };

  return {
    source: {
      captureFence,
      page: async () => {
        throw sourceFailure(CheckpointSourceError.HistoryUnavailable);
      },
      readAttachment,
    },
    attachments: attached,
    validate,
  };
}
