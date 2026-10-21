import { expect, it } from 'vitest';
import { AgentProvider } from '@protocol';
import { localFixture } from '../../helpers/local/local-runtime.js';

it('puts the models of each agent on the snapshot, replacing that agent’s earlier list', async () => {
  const f = localFixture();

  try {
    expect(f.monitor.snapshot().models).toBeUndefined();

    f.monitor.setProviderModels(AgentProvider.Codex, [{ id: 'synthetic-old', efforts: [] }]);
    f.monitor.setProviderModels(AgentProvider.Claude, [{ id: 'synthetic-alias', efforts: ['high'] }]);
    f.monitor.setProviderModels(AgentProvider.Codex, [{ id: 'synthetic-new', efforts: ['low'] }]);

    expect(f.monitor.snapshot().models).toEqual([
      { provider: AgentProvider.Codex, models: [{ id: 'synthetic-new', efforts: ['low'] }] },
      { provider: AgentProvider.Claude, models: [{ id: 'synthetic-alias', efforts: ['high'] }] },
    ]);
  } finally {
    await f.close();
  }
});
