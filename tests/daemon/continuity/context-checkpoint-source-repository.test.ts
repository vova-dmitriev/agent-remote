import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import {
  BindingState,
  ConnectorId,
  EventType,
  IntegrationState,
  MessageRole,
  SessionStatus,
  TargetKind,
  type HistoryMessage,
  type Session,
} from '@protocol';
import { AttachmentService } from '../../../apps/daemon/src/attachments/service.js';
import { ContextCheckpointManager } from '../../../apps/daemon/src/continuity/context/checkpoint.js';
import { createCodexCheckpointSource } from '../../../apps/daemon/src/continuity/source/native.js';
import { probeRepository } from '../../../apps/daemon/src/continuity/source/repository.js';
import type { RepositoryWorkingTreeIdentity } from '../../../apps/daemon/src/continuity/source/types.js';
import {
  CheckpointSourceError,
  NativeCheckpointSourceLimits,
} from '../../../apps/daemon/src/continuity/source/values.js';
import { LocalStore } from '../../../apps/daemon/src/monitor/store.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  await execFile('git', ['-C', cwd, ...args], { timeout: 5000 });
}

async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), 'checkpoint-repository-'));

  roots.push(cwd);
  await git(cwd, 'init', '-q');
  await git(cwd, 'config', 'user.name', 'Checkpoint Test');
  await git(cwd, 'config', 'user.email', 'checkpoint@example.invalid');
  await writeFile(join(cwd, '.gitignore'), '*.ignored\n');
  await writeFile(join(cwd, 'tracked.txt'), 'initial');
  await git(cwd, 'add', '.gitignore', 'tracked.txt');
  await git(cwd, 'commit', '-q', '-m', 'fixture');
  await writeFile(join(cwd, 'visible.txt'), 'untracked');
  await writeFile(join(cwd, 'private.ignored'), 'synthetic ignored fixture');

  return cwd;
}

it('labels the persisted worktree fence as bounded Git-visible metadata and tracks revision/metadata changes', async () => {
  const cwd = await repository();
  const first = await probeRepository(cwd);

  expect(first.workingTree).toMatch(/^git-visible-metadata-v1:3:[a-f0-9]{64}$/u);
  await writeFile(join(cwd, 'tracked.txt'), 'changed with a different length');
  const metadataChanged = await probeRepository(cwd);

  expect(metadataChanged.revision).toBe(first.revision);
  expect(metadataChanged.workingTree).not.toBe(first.workingTree);
  await git(cwd, 'add', 'tracked.txt');
  await git(cwd, 'commit', '-q', '-m', 'advance revision');
  const revisionChanged = await probeRepository(cwd);

  expect(revisionChanged.revision).not.toBe(first.revision);
  expect(revisionChanged.workingTree).toBe(metadataChanged.workingTree);
});

it('rejects the bounded metadata probe when the visible path budget is exceeded', async () => {
  const cwd = await repository();

  await mkdir(join(cwd, 'many'));

  for (let index = 0; index <= NativeCheckpointSourceLimits.GitFileEntries; index += 1) {
    await writeFile(join(cwd, 'many', `file-${index.toString().padStart(5, '0')}`), 'x');
  }

  await expect(probeRepository(cwd)).rejects.toThrow(CheckpointSourceError.RepositoryBudgetExceeded);
});

it('persists the production scope label and rejects a scope-version change after restart', async () => {
  const cwd = await repository();
  const checkpointDirectory = await mkdtemp(join(tmpdir(), 'checkpoint-manifest-'));

  roots.push(checkpointDirectory);

  const current: Session = {
    id: 'native-codex',
    cwd,
    target: { connectorId: ConnectorId.Native, deviceId: 'device-a', kind: TargetKind.CodexCli },
    claudeSessionId: null,
    generation: 'generation-a',
    status: SessionStatus.Idle,
    binding: BindingState.Verified,
    lastEventAt: 1,
    capabilities: { observe: true, history: true, prompt: true, interrupt: true, createSession: false },
    integrationState: IntegrationState.Ready,
  } as Session;

  const store = new LocalStore(':memory:', 'device-a');
  const message: HistoryMessage = { id: 'message-a', role: MessageRole.User, text: 'task', occurredAt: 1 };

  store.append({
    sessionId: current.id,
    type: EventType.Message,
    payload: message,
    occurredAt: message.occurredAt,
  });

  const attachmentService = {
    async prepare() {
      return [];
    },
  } as unknown as AttachmentService;

  let identity = await probeRepository(cwd);

  const source = createCodexCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    sessionId: current.id,
    generation: current.generation,
    currentSession: () => current,
    store,
    attachments: attachmentService,
    repositoryProbe: async () => identity,
  });

  const manager = new ContextCheckpointManager({ directory: checkpointDirectory, ownerId: 'owner-a' });

  const draft = await manager.prepareCheckpoint(source, {
    selectedMessageIds: ['message-a'],
    selectedAttachmentIds: [],
    constraints: [],
  });

  const summary = await manager.finalizeCheckpoint(
    draft.id,
    'manual continuation',
    { kind: 'manual' },
    draft.digest,
    source,
  );

  const restarted = await new ContextCheckpointManager({
    directory: checkpointDirectory,
    ownerId: 'owner-a',
  }).readCheckpoint(draft.id, summary.digest, source);

  expect(restarted.source.workingTree).toMatch(/^git-visible-metadata-v1:3:[a-f0-9]{64}$/u);

  identity = {
    ...identity,
    workingTree: identity.workingTree.replace(
      'git-visible-metadata-v1',
      'git-visible-metadata-v2',
    ) as RepositoryWorkingTreeIdentity,
  };

  await expect(
    new ContextCheckpointManager({ directory: checkpointDirectory, ownerId: 'owner-a' }).readCheckpoint(
      draft.id,
      summary.digest,
      source,
    ),
  ).rejects.toThrow('CHECKPOINT_SOURCE_CHANGED');

  store.close();
});
