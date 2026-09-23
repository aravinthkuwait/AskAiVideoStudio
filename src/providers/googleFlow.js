// Google Flow adapter — PLACEHOLDER ONLY in Phase 1.
// Production Flow automation is intentionally DISABLED until the Flow
// Feasibility Lab has been validated manually (see docs/FLOW_FEASIBILITY.md).
// Design constraints for the future implementation:
//  - runs in a separate browser-worker process (never in the web process)
//  - uses an isolated per-account profile under PRIVATE_STORAGE_ROOT/browser-profiles
//  - NEVER stores Google passwords; login is interactive and manual
//  - PAUSES on CAPTCHA / MFA / verification and waits for the user
//  - NEVER auto-rotates accounts; switching requires explicit user selection
//  - asks for explicit confirmation before any action that consumes credits
import { ProviderError } from './types.js';

export function createGoogleFlowImageProvider() {
  return {
    id: 'GOOGLE_FLOW',
    label: 'Google Flow (not enabled)',
    kind: 'image',
    consumesCredits: true,
    availability: () => ({ ok: false, reason: 'Google Flow automation is not enabled yet. It will be enabled only after the Flow Feasibility Lab is validated.' }),
    async generateImage() {
      throw new ProviderError('Google Flow automation is not enabled.', { code: 'PROVIDER_DISABLED' });
    },
  };
}
