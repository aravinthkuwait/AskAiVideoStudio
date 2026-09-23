// Background job service (API side). The worker executes jobs; this module
// enqueues, pauses, resumes, retries, skips and reports — all tenant-scoped.
import { newId, nowIso, sha256 } from '../lib/ids.js';
import { validate } from '../lib/validate.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { transaction } from '../persistence/database.js';
import { ACTIVE_STATES, OPEN_STATES, canTransition, sourcesFor } from '../jobs/states.js';
import { getProject } from './projects.js';
import { audit } from './audit.js';

const inList = (arr) => arr.map((s) => `'${s}'`).join(',');

export function jobView(j) {
  if (!j) return null;
  return {
    id: j.id, projectId: j.project_id, sceneId: j.scene_id, runId: j.run_id, sequence: j.sequence, type: j.type, provider: j.provider,
    state: j.state, progress: j.progress, retryCount: j.retry_count, errorSummary: j.error_summary,
    createdAt: j.created_at, updatedAt: j.updated_at, startedAt: j.started_at, finishedAt: j.finished_at,
    sceneTitle: j.scene_title ?? undefined, scenePosition: j.scene_position ?? undefined,
  };
}

export function getJob(db, ctx, id) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
  if (!j) throw notFound('Job');
  return j;
}

/** Recompute a scene's image_status from candidates + jobs (SKIPPED is sticky). */
export function refreshSceneImageStatus(db, tenantId, sceneId) {
  const s = db.prepare('SELECT image_status, approved_candidate_id FROM scenes WHERE id = ? AND tenant_id = ?').get(sceneId, tenantId);
  if (!s || s.image_status === 'SKIPPED') return;
  let status;
  if (s.approved_candidate_id) status = 'APPROVED';
  else {
    const job = db.prepare(`SELECT state FROM jobs WHERE scene_id = ? AND tenant_id = ? AND type = 'IMAGE_GENERATE' ORDER BY created_at DESC LIMIT 1`).get(sceneId, tenantId);
    const c = db.prepare(`SELECT SUM(status != 'REJECTED') AS live, COUNT(*) AS total FROM image_candidates WHERE scene_id = ? AND tenant_id = ?`).get(sceneId, tenantId);
    if (job && ACTIVE_STATES.includes(job.state)) status = 'GENERATING';
    else if (job && job.state === 'QUEUED') status = 'QUEUED';
    else if (c.live > 0) status = 'CANDIDATES';
    else if (job && ['FAILED', 'INTERRUPTED'].includes(job.state)) status = 'FAILED';
    else if (c.total > 0) status = 'REJECTED';
    else status = 'PENDING';
  }
  if (status !== s.image_status) db.prepare('UPDATE scenes SET image_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, nowIso(), sceneId, tenantId);
}

/** Compare-and-set state change. Returns true if applied. */
export function transitionJob(db, tenantId, jobId, to, fields = {}) {
  const from = sourcesFor(to);
  const sets = ['state = ?', 'updated_at = ?'];
  const args = [to, nowIso()];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); args.push(v); }
  const r = db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? AND state IN (${inList(from)})`).run(...args, jobId, tenantId);
  return r.changes === 1;
}

const ENQUEUE_SCHEMA = {
  provider: { type: 'string', enum: ['SIMULATED', 'GOOGLE_FLOW'], default: 'SIMULATED' },
  sceneIds: { type: 'ids', max: 1000 },
  force: { type: 'bool', default: false },
  simulate: { type: 'object' },
  confirmCredits: { type: 'bool', default: false },
};

/**
 * Enqueue image generation for a project. Scenes that already have a
 * COMPLETED job for the same prompt/provider are NOT regenerated unless
 * force=true (explicit "generate another candidate").
 */
export function enqueueImageRun(db, ctx, providers, projectId, input) {
  getProject(db, ctx, projectId);
  const data = validate(input, ENQUEUE_SCHEMA);
  const provider = providers.get(data.provider);
  const availability = provider?.availability();
  if (!provider || !availability.ok) throw badRequest(availability?.reason || 'Provider is not available.');
  if (provider.consumesCredits && !data.confirmCredits) throw conflict('This provider may consume paid credits. Explicit confirmation is required.');
  let simulate = null;
  if (data.simulate) {
    if (provider.id !== 'SIMULATED') throw badRequest('Failure simulation is only available for the simulated provider.');
    simulate = validate(data.simulate, { failTimes: { type: 'int', min: 0, max: 5, default: 0 }, failAt: { type: 'string', enum: ['GENERATING', 'DOWNLOADING'], default: 'GENERATING' }, sceneIds: { type: 'ids' } });
  }

  return transaction(db, () => {
    let scenes = db.prepare(`SELECT id, position, image_prompt, negative_prompt, aspect_ratio, image_status, image_source FROM scenes
      WHERE project_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY position`).all(projectId, ctx.tenantId);
    if (data.sceneIds) {
      const want = new Set(data.sceneIds);
      scenes = scenes.filter((s) => want.has(s.id));
      if (scenes.length !== want.size) throw notFound('Scene');
    } else {
      scenes = scenes.filter((s) => s.image_source === 'FLOW' && !['APPROVED', 'SKIPPED'].includes(s.image_status));
    }
    const runId = newId();
    const now = nowIso();
    db.prepare(`INSERT INTO generation_runs (id, tenant_id, project_id, owner_id, type, provider, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'IMAGE_GENERATE', ?, 'ACTIVE', ?, ?)`).run(runId, ctx.tenantId, projectId, ctx.userId, provider.id, now, now);
    const ins = db.prepare(`INSERT INTO jobs (id, tenant_id, owner_id, project_id, scene_id, run_id, sequence, type, provider, state, idempotency_key, input_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'IMAGE_GENERATE', ?, 'QUEUED', ?, ?, ?, ?)`);
    const result = { runId, queued: [], skipped: [] };
    for (const s of scenes) {
      if (!s.image_prompt.trim()) { result.skipped.push({ sceneId: s.id, reason: 'No image prompt.' }); continue; }
      if (s.image_status === 'SKIPPED') { result.skipped.push({ sceneId: s.id, reason: 'Scene is skipped.' }); continue; }
      const key = `IMAGE_GENERATE:${s.id}:${provider.id}:${sha256(`${s.image_prompt}\u0000${s.negative_prompt}\u0000${s.aspect_ratio}`).slice(0, 32)}`;
      const open = db.prepare(`SELECT id FROM jobs WHERE idempotency_key = ? AND state IN (${inList(OPEN_STATES)})`).get(key);
      if (open) { result.skipped.push({ sceneId: s.id, reason: 'Already queued or in progress.', jobId: open.id }); continue; }
      if (!data.force && db.prepare(`SELECT 1 FROM jobs WHERE idempotency_key = ? AND state = 'COMPLETED'`).get(key)) {
        result.skipped.push({ sceneId: s.id, reason: 'Already generated for this prompt (not regenerated automatically).' }); continue;
      }
      const jobInput = { prompt: s.image_prompt, negativePrompt: s.negative_prompt, aspectRatio: s.aspect_ratio };
      if (simulate && (!simulate.sceneIds || simulate.sceneIds.includes(s.id))) jobInput.simulate = { failTimes: simulate.failTimes, failAt: simulate.failAt };
      const jobId = newId();
      ins.run(jobId, ctx.tenantId, ctx.userId, projectId, s.id, runId, s.position, provider.id, key, JSON.stringify(jobInput), now, now);
      refreshSceneImageStatus(db, ctx.tenantId, s.id);
      result.queued.push({ sceneId: s.id, jobId });
    }
    if (result.queued.length === 0) {
      db.prepare(`UPDATE generation_runs SET state = 'COMPLETED' WHERE id = ?`).run(runId);
    }
    audit(db, ctx, 'run.create', 'project', projectId, { runId, provider: provider.id, queued: result.queued.length });
    return result;
  });
}

export function getRun(db, ctx, runId) {
  const r = db.prepare('SELECT * FROM generation_runs WHERE id = ? AND tenant_id = ?').get(runId, ctx.tenantId);
  if (!r) throw notFound('Generation run');
  return r;
}

export function runSummary(db, ctx, runId) {
  const run = getRun(db, ctx, runId);
  const jobs = db.prepare(`SELECT j.*, s.title AS scene_title, s.position AS scene_position FROM jobs j LEFT JOIN scenes s ON s.id = j.scene_id AND s.tenant_id = j.tenant_id
    WHERE j.run_id = ? AND j.tenant_id = ? ORDER BY j.sequence`).all(runId, ctx.tenantId);
  const counts = {};
  for (const j of jobs) counts[j.state] = (counts[j.state] || 0) + 1;
  const firstOpen = jobs.find((j) => ['PAUSED', 'INTERRUPTED', 'FAILED', 'QUEUED', ...ACTIVE_STATES].includes(j.state));
  const resumable = jobs.some((j) => ['PAUSED', 'INTERRUPTED'].includes(j.state)) || run.state === 'PAUSED';
  return {
    id: run.id, projectId: run.project_id, provider: run.provider, state: run.state, createdAt: run.created_at, updatedAt: run.updated_at,
    counts, total: jobs.length,
    resumePoint: resumable && firstOpen ? { sceneId: firstOpen.scene_id, scenePosition: firstOpen.scene_position, sceneTitle: firstOpen.scene_title, jobId: firstOpen.id } : null,
    jobs: jobs.map(jobView),
  };
}

export function listRuns(db, ctx, projectId, { limit = 5 } = {}) {
  getProject(db, ctx, projectId);
  return db.prepare('SELECT id FROM generation_runs WHERE project_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, ctx.tenantId, Math.min(Number(limit) || 5, 50)).map((r) => runSummary(db, ctx, r.id));
}

/** Pause a whole run: queued + in-flight jobs become PAUSED (in-flight stop at their next checkpoint). */
export function pauseRun(db, ctx, runId) {
  getRun(db, ctx, runId);
  return transaction(db, () => {
    db.prepare(`UPDATE generation_runs SET state = 'PAUSED', updated_at = ? WHERE id = ? AND tenant_id = ? AND state = 'ACTIVE'`).run(nowIso(), runId, ctx.tenantId);
    db.prepare(`UPDATE jobs SET state = 'PAUSED', updated_at = ? WHERE run_id = ? AND tenant_id = ? AND state IN (${inList(sourcesFor('PAUSED'))})`).run(nowIso(), runId, ctx.tenantId);
    refreshRunScenes(db, ctx.tenantId, runId);
    audit(db, ctx, 'run.pause', 'run', runId);
    return runSummary(db, ctx, runId);
  });
}

/** Resume from the first unfinished scene. COMPLETED jobs are never re-run. */
export function resumeRun(db, ctx, runId) {
  const run = getRun(db, ctx, runId);
  if (run.state === 'CANCELLED') throw conflict('This run was cancelled. Start a new generation instead.');
  return transaction(db, () => {
    db.prepare(`UPDATE generation_runs SET state = 'ACTIVE', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(nowIso(), runId, ctx.tenantId);
    db.prepare(`UPDATE jobs SET state = 'QUEUED', progress = 0, updated_at = ?, error_summary = NULL WHERE run_id = ? AND tenant_id = ? AND state IN ('PAUSED','INTERRUPTED')`).run(nowIso(), runId, ctx.tenantId);
    refreshRunScenes(db, ctx.tenantId, runId);
    audit(db, ctx, 'run.resume', 'run', runId);
    return runSummary(db, ctx, runId);
  });
}

export function cancelRun(db, ctx, runId) {
  getRun(db, ctx, runId);
  return transaction(db, () => {
    db.prepare(`UPDATE generation_runs SET state = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(nowIso(), runId, ctx.tenantId);
    db.prepare(`UPDATE jobs SET state = 'CANCELLED', finished_at = ?, updated_at = ? WHERE run_id = ? AND tenant_id = ? AND state IN (${inList(sourcesFor('CANCELLED'))})`).run(nowIso(), nowIso(), runId, ctx.tenantId);
    refreshRunScenes(db, ctx.tenantId, runId);
    audit(db, ctx, 'run.cancel', 'run', runId);
    return runSummary(db, ctx, runId);
  });
}

function refreshRunScenes(db, tenantId, runId) {
  for (const { scene_id } of db.prepare('SELECT DISTINCT scene_id FROM jobs WHERE run_id = ? AND tenant_id = ? AND scene_id IS NOT NULL').all(runId, tenantId)) {
    refreshSceneImageStatus(db, tenantId, scene_id);
  }
}

function jobAction(db, ctx, jobId, to, extra = {}, auditName) {
  const job = getJob(db, ctx, jobId);
  if (!canTransition(job.state, to)) throw conflict(`A ${job.state.toLowerCase()} job cannot be changed to ${to.toLowerCase()}.`);
  return transaction(db, () => {
    if (!transitionJob(db, ctx.tenantId, jobId, to, extra)) throw conflict('The job changed state; please refresh.');
    if (to === 'QUEUED' && job.run_id) {
      db.prepare(`UPDATE generation_runs SET state = 'ACTIVE', updated_at = ? WHERE id = ? AND tenant_id = ? AND state IN ('PAUSED','COMPLETED')`).run(nowIso(), job.run_id, ctx.tenantId);
    }
    if (job.scene_id) refreshSceneImageStatus(db, ctx.tenantId, job.scene_id);
    audit(db, ctx, auditName, 'job', jobId);
    return jobView(getJob(db, ctx, jobId));
  });
}

export const retryJob = (db, ctx, id) => {
  const job = getJob(db, ctx, id);
  return jobAction(db, ctx, id, 'QUEUED', { retry_count: job.retry_count + 1, progress: 0, error_summary: null, finished_at: null }, 'job.retry');
};
export const pauseJob = (db, ctx, id) => jobAction(db, ctx, id, 'PAUSED', {}, 'job.pause');
export const resumeJob = (db, ctx, id) => jobAction(db, ctx, id, 'QUEUED', { progress: 0, error_summary: null }, 'job.resume');
export const skipJob = (db, ctx, id) => jobAction(db, ctx, id, 'SKIPPED', { finished_at: nowIso() }, 'job.skip');
export const cancelJob = (db, ctx, id) => jobAction(db, ctx, id, 'CANCELLED', { finished_at: nowIso() }, 'job.cancel');

export function listJobs(db, ctx, { projectId = '', state = '', limit = 50, offset = 0 } = {}) {
  const where = ['j.tenant_id = ?'];
  const args = [ctx.tenantId];
  if (projectId) { where.push('j.project_id = ?'); args.push(projectId); }
  if (state === 'OPEN') where.push(`j.state IN (${inList(OPEN_STATES)})`);
  else if (state) { where.push('j.state = ?'); args.push(state); }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = db.prepare(`SELECT j.*, s.title AS scene_title, s.position AS scene_position, p.title AS project_title
    FROM jobs j LEFT JOIN scenes s ON s.id = j.scene_id AND s.tenant_id = j.tenant_id JOIN projects p ON p.id = j.project_id AND p.tenant_id = j.tenant_id
    WHERE ${where.join(' AND ')} ORDER BY j.updated_at DESC LIMIT ? OFFSET ?`).all(...args, lim + 1, Math.max(Number(offset) || 0, 0));
  return { items: rows.slice(0, lim).map((r) => ({ ...jobView(r), projectTitle: r.project_title })), hasMore: rows.length > lim };
}

export function queueStats(db, tenantId = null) {
  const rows = tenantId
    ? db.prepare('SELECT state, COUNT(*) AS n FROM jobs WHERE tenant_id = ? GROUP BY state').all(tenantId)
    : db.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').all();
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}
