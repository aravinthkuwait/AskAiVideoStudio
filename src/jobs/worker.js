// Background worker. Runs inside the web process (WORKER_MODE=embedded) or as
// a separate process (`npm run worker`). One job at a time (bounded), each
// step checkpointed to the database so a crash/restart never loses finished work.
import os from 'node:os';
import { nowIso, newId } from '../lib/ids.js';
import { errorFields } from '../lib/logger.js';
import { transaction } from '../persistence/database.js';
import { ACTIVE_STATES } from './states.js';
import { transitionJob, refreshSceneImageStatus } from '../services/jobs.js';
import { ingestImageBuffer } from '../services/media.js';
import { addCandidate } from '../services/images.js';
import { ProviderError, JobStopped } from '../providers/types.js';

const JOB_TIMEOUT_MS = 10 * 60 * 1000;

export class Worker {
  constructor({ db, storage, config, providers, logger }) {
    this.db = db; this.storage = storage; this.config = config; this.providers = providers;
    this.log = logger.child('worker');
    this.id = `worker-${os.hostname().slice(0, 16)}-${process.pid}-${newId().slice(0, 8)}`;
    this.timer = null;
    this.busy = false;
    this.stopping = false;
    this.current = null;
    this.lastTickAt = null;
  }

  /**
   * Crash recovery. Any job left in an active state belongs to a worker that
   * is gone (single-worker deployment), so it becomes INTERRUPTED. Completed
   * jobs are untouched and will never be regenerated automatically.
   */
  recover() {
    const rows = this.db.prepare(`SELECT id, tenant_id, scene_id FROM jobs WHERE state IN ('PREPARING','GENERATING','DOWNLOADING')`).all();
    transaction(this.db, () => {
      for (const r of rows) {
        transitionJob(this.db, r.tenant_id, r.id, 'INTERRUPTED', { error_summary: 'Interrupted by an application or worker restart. Use Resume to continue.', locked_by: null });
        if (r.scene_id) refreshSceneImageStatus(this.db, r.tenant_id, r.scene_id);
      }
    });
    if (rows.length) this.log.warn('Recovered interrupted jobs', { count: rows.length });
    return rows.length;
  }

  start() {
    this.recover();
    this.stopping = false;
    this.timer = setInterval(() => this.tick(), this.config.workerPollMs);
    this.timer.unref?.();
    this.log.info('Worker started', { workerId: this.id });
  }

  /** Graceful stop: abort the in-flight job (it becomes INTERRUPTED) and wait. */
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    if (this.current) {
      this.current.abort.abort();
      await this.current.done.catch(() => {});
    }
  }

  claim() {
    return transaction(this.db, () => {
      const job = this.db.prepare(`SELECT j.* FROM jobs j LEFT JOIN generation_runs r ON r.id = j.run_id
        WHERE j.state = 'QUEUED' AND (r.id IS NULL OR r.state = 'ACTIVE')
        ORDER BY r.created_at, j.sequence, j.created_at LIMIT 1`).get();
      if (!job) return null;
      const ok = transitionJob(this.db, job.tenant_id, job.id, 'PREPARING', {
        locked_by: this.id, heartbeat_at: nowIso(), started_at: nowIso(), progress: 2,
        checkpoint_json: JSON.stringify({ step: 'PREPARING', at: nowIso() }),
      });
      if (!ok) return null;
      if (job.scene_id) refreshSceneImageStatus(this.db, job.tenant_id, job.scene_id);
      return { ...job, state: 'PREPARING' };
    });
  }

  async tick() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    this.lastTickAt = Date.now();
    try {
      this.finishIdleRuns();
      const job = this.claim();
      if (job) {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(new Error('timeout')), JOB_TIMEOUT_MS);
        const done = this.execute(job, abort).finally(() => { clearTimeout(timeout); this.finishIdleRuns(); });
        this.current = { job, abort, done };
        await done;
      }
    } catch (err) {
      this.log.error('Worker tick failed', errorFields(err));
    } finally {
      this.current = null;
      this.busy = false;
    }
  }

  /** Runs every queued job until the queue is empty (used by tests/CLI). */
  async drain(maxJobs = 1000) {
    for (let i = 0; i < maxJobs; i++) {
      const before = this.db.prepare(`SELECT COUNT(*) AS n FROM jobs j LEFT JOIN generation_runs r ON r.id = j.run_id WHERE j.state = 'QUEUED' AND (r.id IS NULL OR r.state = 'ACTIVE')`).get().n;
      if (!before) break;
      await this.tick();
    }
    this.finishIdleRuns();
  }

  finishIdleRuns() {
    this.db.prepare(`UPDATE generation_runs SET state = 'COMPLETED', updated_at = ? WHERE state = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.run_id = generation_runs.id AND j.state IN ('QUEUED','PREPARING','GENERATING','DOWNLOADING','PAUSED','INTERRUPTED','FAILED'))`).run(nowIso());
  }

  async execute(job, abort) {
    const { db } = this;
    const ctx = { tenantId: job.tenant_id, userId: job.owner_id };
    const log = this.log.child(job.type);
    const input = JSON.parse(job.input_json || '{}');
    const provider = this.providers.get(job.provider);
    const cas = (to, fields) => transitionJob(db, job.tenant_id, job.id, to, { heartbeat_at: nowIso(), ...fields });
    let state = 'PREPARING';
    const hooks = {
      signal: abort.signal,
      step: (next, progress) => {
        if (abort.signal.aborted) return false;
        const ok = cas(next, { progress, checkpoint_json: JSON.stringify({ step: next, at: nowIso() }) });
        if (ok) { state = next; if (job.scene_id) refreshSceneImageStatus(db, job.tenant_id, job.scene_id); }
        return ok;
      },
      progress: (p) => {
        if (abort.signal.aborted) return false;
        return db.prepare(`UPDATE jobs SET progress = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND state = ?`).run(Math.min(99, p), nowIso(), nowIso(), job.id, state).changes === 1;
      },
    };

    try {
      if (!provider) throw new ProviderError('Provider is not registered.');
      const avail = provider.availability(this.config);
      if (!avail.ok) throw new ProviderError(avail.reason || 'Provider unavailable.', { code: 'PROVIDER_DISABLED' });
      if (job.type !== 'IMAGE_GENERATE') throw new ProviderError('This job type is not supported yet.');
      log.info('Job started', { job_id: job.id, project_id: job.project_id, provider: job.provider });

      const result = await provider.generateImage({
        jobId: job.id, sceneId: job.scene_id, prompt: input.prompt, negativePrompt: input.negativePrompt,
        aspectRatio: input.aspectRatio, attempt: job.retry_count, simulate: input.simulate,
      }, hooks);
      if (abort.signal.aborted) throw new JobStopped();

      // Final step is atomic + idempotent: media, candidate and COMPLETED together.
      transaction(db, () => {
        const current = db.prepare('SELECT state FROM jobs WHERE id = ?').get(job.id).state;
        if (current !== 'DOWNLOADING') throw new JobStopped();
        const media = ingestImageBuffer(ctx, { db, storage: this.storage }, {
          buffer: result.buffer, mime: result.mime, ext: result.ext, projectId: job.project_id,
          source: provider.id, width: result.width, height: result.height, label: `${provider.id.toLowerCase()}-${job.id.slice(0, 8)}.${result.ext}`,
        });
        const cand = addCandidate(db, ctx, job.scene_id, media.id, provider.id === 'GOOGLE_FLOW' ? 'FLOW' : 'SIMULATED', { jobId: job.id });
        if (!cas('COMPLETED', { progress: 100, finished_at: nowIso(), locked_by: null, output_json: JSON.stringify({ candidateId: cand.id, mediaId: media.id }),
          checkpoint_json: JSON.stringify({ step: 'COMPLETED', at: nowIso() }) })) throw new JobStopped();
        refreshSceneImageStatus(db, job.tenant_id, job.scene_id);
      });
      log.info('Job completed', { job_id: job.id, project_id: job.project_id });
    } catch (err) {
      if (err instanceof JobStopped || abort.signal.aborted) {
        // Paused/cancelled by the user, or aborted by shutdown/timeout.
        const reason = abort.signal.reason?.message === 'timeout' ? 'The job timed out. Use Retry to try again.' : 'Interrupted during shutdown. Use Resume to continue.';
        if (abort.signal.aborted) {
          if (abort.signal.reason?.message === 'timeout') cas('FAILED', { error_summary: reason, finished_at: nowIso(), locked_by: null });
          else cas('INTERRUPTED', { error_summary: reason, locked_by: null });
        } else {
          db.prepare('UPDATE jobs SET locked_by = NULL WHERE id = ?').run(job.id);
        }
        log.info('Job stopped', { job_id: job.id, state: db.prepare('SELECT state FROM jobs WHERE id = ?').get(job.id).state });
      } else {
        const safe = err instanceof ProviderError ? err.safeMessage : 'Unexpected error while generating. Details are in the server log.';
        cas('FAILED', { error_summary: safe.slice(0, 500), finished_at: nowIso(), locked_by: null });
        log.warn('Job failed', { job_id: job.id, project_id: job.project_id, ...errorFields(err) });
      }
      if (job.scene_id) refreshSceneImageStatus(db, job.tenant_id, job.scene_id);
    }
  }

  status() {
    return { id: this.id, running: !!this.timer && !this.stopping, busy: this.busy, lastTickAt: this.lastTickAt ? new Date(this.lastTickAt).toISOString() : null };
  }
}

export { ACTIVE_STATES };
