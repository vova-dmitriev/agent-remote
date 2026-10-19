import { DesktopMode, DesktopOperation } from '../domain/desktop.js';
import {
  ErrorCode,
  TargetKind,
  SessionStatus,
  CommandStatus,
  ConnectorTransport,
  IntegrationState,
  BindingState,
  StatusConfidence,
  type Session,
  type Target,
  validatePrompt,
} from '@protocol';
import { randomUUID } from 'node:crypto';
import { SourceAdapter, type Binding, type DispatchReceipt } from '../adapters/registry.js';

export interface DesktopBinding {
  bindingId: string;
  generation: string;
  canPrompt: boolean;
  canInterrupt: boolean;
  canHistory: boolean;
  claudeSessionId?: string;
  hookVerified?: boolean;
}

export function createDesktopSource(
  mode: DesktopMode,
  deviceId: string,
  desktop: DesktopBinding,
  bridge: { request: (request: unknown) => Promise<unknown> },
  flags: { inputEnabled: boolean; permissionsEnabled: boolean },
) {
  if (mode === DesktopMode.Code && !desktop.claudeSessionId) {
    throw new Error(ErrorCode.DESKTOP_CODE_ID_UNVERIFIED);
  }

  const connectorId = randomUUID();

  const target: Target =
    mode === DesktopMode.Chat
      ? { kind: TargetKind.ClaudeDesktopChat, deviceId, connectorId, chatBindingId: desktop.bindingId }
      : {
          kind: TargetKind.ClaudeCodeDesktop,
          deviceId,
          connectorId,
          claudeSessionId: desktop.claudeSessionId!,
        };

  const ready = desktop.canHistory && desktop.canPrompt;

  const capabilities = {
    observe: true,
    history: desktop.canHistory,
    prompt: ready && flags.inputEnabled,
    interrupt: ready && desktop.canInterrupt && flags.inputEnabled,
    permission:
      mode === DesktopMode.Code && desktop.hookVerified === true && ready && flags.permissionsEnabled,
    terminalSnapshot: false,
  };

  const binding: Binding = { target, generation: desktop.generation, localProof: randomUUID() };

  const operation = async (
    type: typeof DesktopOperation.SendPrompt | typeof DesktopOperation.Interrupt,
    text?: string,
  ): Promise<DispatchReceipt> => {
    try {
      return (await bridge.request({
        operation: type,
        bindingId: desktop.bindingId,
        ...(text !== undefined ? { text } : {}),
      })) as DispatchReceipt;
    } catch (error) {
      if (
        error instanceof Error &&
        [ErrorCode.UNKNOWN_AFTER_WRITE, ErrorCode.HELPER_TIMEOUT, ErrorCode.HELPER_EXITED].some(
          (candidateValue) => candidateValue === error.message,
        )
      ) {
        return { status: CommandStatus.Unknown, code: error.message };
      }

      throw error;
    }
  };

  const adapter = new SourceAdapter(
    {
      connectorId,
      kind: target.kind,
      transport: ConnectorTransport.Accessibility,
      sourceVersion: 'installed-Claude',
      capabilities,
      state: ready ? IntegrationState.Ready : IntegrationState.NeedsSetup,
      reason: ready ? null : 'AX_CHAT_OR_COMPOSER_UNVERIFIED',
    },
    {
      prompt: async (_binding, text) => {
        validatePrompt(text);

        return operation(DesktopOperation.SendPrompt, text);
      },
      interrupt: async () => operation(DesktopOperation.Interrupt),
    },
  );

  adapter.bind(binding);

  const session: Session = {
    id: randomUUID(),
    target,
    claudeSessionId: mode === DesktopMode.Code ? (desktop.claudeSessionId ?? null) : null,
    generation: desktop.generation,
    status: SessionStatus.Unknown,
    binding: BindingState.Verified,
    lastEventAt: Date.now(),
    capabilities,
    integrationState: ready ? IntegrationState.Ready : IntegrationState.NeedsSetup,
    statusConfidence: StatusConfidence.Inferred,
  };

  return { adapter, binding, session };
}
