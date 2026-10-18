import { IntegrationState } from '../../../../../packages/protocol/src/index.js';
import type { bindCodex, CodexClient } from '../binding.js';

export type CodexBinding = Awaited<ReturnType<typeof bindCodex>>;

interface BindingRegistry {
  bindings: Map<string, CodexBinding>;
  clients: Map<string, CodexClient>;
}

export async function retainConnectedBinding(registry: BindingRegistry, id: string) {
  const binding = registry.bindings.get(id);

  if (!binding) {
    return false;
  }

  if (binding.session.integrationState !== IntegrationState.Disconnected) {
    return true;
  }

  await binding.close();
  registry.bindings.delete(id);
  await registry.clients.get(id)?.close();
  registry.clients.delete(id);

  return false;
}
