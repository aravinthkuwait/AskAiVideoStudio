// SIMULATED image provider — for demos and tests. Produces a synthetic
// gradient PNG locally. Consumes NO credits and makes NO network calls.
import { setTimeout as sleep } from 'node:timers/promises';
import { gradientPng, seedColors } from '../lib/png.js';
import { ProviderError, JobStopped } from './types.js';

const SIZES = { '16:9': [320, 180], '9:16': [180, 320], '1:1': [256, 256], '4:3': [320, 240], '21:9': [336, 144] };

export function createSimulatedImageProvider({ stepMs = 400 } = {}) {
  return {
    id: 'SIMULATED',
    label: 'Simulated (demo — no credits)',
    kind: 'image',
    consumesCredits: false,
    availability: () => ({ ok: true }),
    async generateImage(req, hooks) {
      const wait = async () => {
        await sleep(stepMs, undefined, { signal: hooks.signal }).catch(() => { throw new JobStopped(); });
      };
      const failAt = req.simulate?.failAt || 'GENERATING';
      const shouldFail = (req.simulate?.failTimes ?? 0) > req.attempt;
      if (!hooks.step('GENERATING', 10)) throw new JobStopped();
      for (const p of [30, 55, 80]) {
        await wait();
        if (shouldFail && failAt === 'GENERATING' && p === 55) throw new ProviderError('Simulated generation failure (demo).');
        if (!hooks.progress(p)) throw new JobStopped();
      }
      if (!hooks.step('DOWNLOADING', 90)) throw new JobStopped();
      await wait();
      if (shouldFail && failAt === 'DOWNLOADING') throw new ProviderError('Simulated download failure (demo).', { retryable: true });
      const [w, h] = SIZES[req.aspectRatio] || SIZES['16:9'];
      const [a, b] = seedColors(`${req.sceneId}:${req.jobId}`);
      return { buffer: gradientPng(w, h, a, b), mime: 'image/png', ext: 'png', width: w, height: h };
    },
  };
}
