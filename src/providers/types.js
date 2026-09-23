// Provider adapter interfaces. Project logic depends ONLY on these shapes, so
// Google Flow (or any future provider) plugs in without rewriting workflows.
//
// @typedef {object} ProviderInfo
// @property {string} id            Stable identifier, e.g. 'SIMULATED', 'GOOGLE_FLOW'
// @property {string} label         Human label
// @property {'image'|'video'|'voice'} kind
// @property {boolean} consumesCredits  true if a real call may spend paid credits
// @property {(config) => {ok: boolean, reason?: string}} availability
//
// @typedef {object} RunHooks
// @property {(state: 'GENERATING'|'DOWNLOADING', progress: number) => boolean} step
//           Persist a checkpoint. Returns false if the job was paused/cancelled — the provider must stop.
// @property {(progress: number) => boolean} progress
// @property {AbortSignal} signal
//
// ImageProvider: ProviderInfo & { generateImage(request, hooks) => Promise<{buffer, mime, ext, width, height}> }
//   request: { jobId, sceneId, prompt, negativePrompt, aspectRatio, attempt, simulate? }
// VideoProvider: ProviderInfo & { generateVideo(request, hooks) => Promise<{filePath|buffer, mime, ext, durationMs}> }
//   request: { jobId, sceneId, prompt, imageMediaPath, durationSec, aspectRatio }
// VoiceProvider: ProviderInfo & { synthesize(request, hooks) => Promise<{buffer, mime, ext, durationMs}> }

export class ProviderError extends Error {
  /** @param {string} safeMessage user-safe summary; @param {{retryable?: boolean, code?: string, pauseAccount?: boolean}} opts */
  constructor(safeMessage, { retryable = false, code = 'PROVIDER_ERROR', pauseAccount = false } = {}) {
    super(safeMessage);
    this.safeMessage = safeMessage;
    this.retryable = retryable;
    this.code = code;
    this.pauseAccount = pauseAccount; // e.g. CURRENT FLOW ACCOUNT CANNOT CONTINUE → pause, never auto-rotate
  }
}

/** Thrown internally when a job is paused/cancelled mid-run (not an error). */
export class JobStopped extends Error {}
