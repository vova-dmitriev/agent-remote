import {
  AttachmentMode,
  CommandStatus,
  ConnectorTransport,
  IntegrationState,
  TargetKind,
  type CmuxTarget,
} from '@protocol';
import { SourceAdapter, type AdapterRegistry } from '../adapters/registry.js';
import { SourceVersion } from '../domain/runtime.js';
import { attachmentPrompt } from '../attachments/content/input.js';
import { CmuxClient } from './client.js';
import type { CmuxContext, CmuxSurface } from './context.js';
import { prepareCmuxContext } from './launch.js';

type Terminal = Pick<CmuxClient, 'pasteAndSubmit' | 'sendEscape' | 'sendEnter' | 'readScreen' | 'type'>;

export interface CmuxAttachOptions {
  adapters: AdapterRegistry;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  /** Resolves the window that owns the surface (`cmux identify`); undefined or a throw means "not in cmux". */
  resolve?: (surface: CmuxSurface) => Promise<CmuxContext | undefined>;
  terminal?: Terminal;
}

/**
 * Sessions that cmux started itself (not through the claude-remote wrapper) report their surface with every hook.
 * Once cmux confirms the surface, the session gets a cmux connector: prompts are pasted into that surface, Escape
 * interrupts and the screen can be read, with no restart. The connector id is the surface id, so one surface maps
 * to one connector across hooks and daemon restarts.
 */
export function cmuxAttacher(options: CmuxAttachOptions) {
  const terminal = options.terminal ?? new CmuxClient();

  const resolve =
    options.resolve ??
    ((surface: CmuxSurface) =>
      prepareCmuxContext({ CMUX_WORKSPACE_ID: surface.workspaceId, CMUX_SURFACE_ID: surface.surfaceId }));

  return async function attach(surface: CmuxSurface, deviceId: string): Promise<CmuxTarget | undefined> {
    const context = await resolve(surface).catch(() => undefined); // ignore: an unconfirmed surface stays observe-only

    if (
      !context ||
      context.workspaceId.toLowerCase() !== surface.workspaceId.toLowerCase() ||
      context.surfaceId.toLowerCase() !== surface.surfaceId.toLowerCase()
    ) {
      return undefined;
    }

    const connectorId = context.surfaceId;
    const target: CmuxTarget = { kind: TargetKind.Cmux, deviceId, connectorId, ...context };

    if (!options.adapters.get(connectorId)) {
      options.adapters.register(
        new SourceAdapter(
          {
            connectorId,
            kind: TargetKind.Cmux,
            transport: ConnectorTransport.Cmux,
            sourceVersion: SourceVersion.Unknown,
            capabilities: {
              observe: true,
              history: true,
              prompt: options.inputEnabled,
              interrupt: options.inputEnabled,
              permission: options.permissionsEnabled,
              userInput: options.inputEnabled,
              terminalSnapshot: true,
              terminalInput: options.inputEnabled,
              ...(options.inputEnabled
                ? { attachments: { images: AttachmentMode.Reference, files: AttachmentMode.Reference } }
                : {}),
            },
            state: IntegrationState.Ready,
            reason: null,
          },
          {
            prompt: async (binding, text, attachments = []) => {
              await terminal.pasteAndSubmit(
                binding.target as CmuxTarget,
                attachmentPrompt(text, attachments),
              );

              return { status: CommandStatus.Dispatched };
            },
            enter: (binding) => terminal.sendEnter(binding.target as CmuxTarget),
            interrupt: async (binding) => {
              await terminal.sendEscape(binding.target as CmuxTarget);

              return { status: CommandStatus.Dispatched };
            },
            screen: (binding) => terminal.readScreen(binding.target as CmuxTarget),
            terminal: (binding, input) => terminal.type(binding.target as CmuxTarget, input),
          },
        ),
      );
    }

    return target;
  };
}
