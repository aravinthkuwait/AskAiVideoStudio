import { createSimulatedImageProvider } from './simulated.js';
import { createGoogleFlowImageProvider } from './googleFlow.js';

export function createProviderRegistry(config) {
  const providers = [
    createSimulatedImageProvider({ stepMs: config.simulatedStepMs }),
    createGoogleFlowImageProvider(config),
  ];
  const byId = new Map(providers.map((p) => [p.id, p]));
  return {
    get: (id) => byId.get(id) || null,
    list: (kind) => providers.filter((p) => !kind || p.kind === kind).map((p) => {
      const a = p.availability(config);
      return { id: p.id, label: p.label, kind: p.kind, consumesCredits: p.consumesCredits, available: a.ok, reason: a.reason || null };
    }),
  };
}
