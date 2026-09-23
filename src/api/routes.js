// REST API. Designed to be reused by a future Android/iOS client: JSON in/out,
// cookie session + CSRF header. Tenant/user identity comes ONLY from the session.
import fs from 'node:fs';
import { readJson } from '../http/io.js';
import { badRequest, notFound, forbidden, tooMany, tooLarge } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import * as projects from '../services/projects.js';
import * as scenes from '../services/scenes.js';
import * as images from '../services/images.js';
import * as library from '../services/library.js';
import * as jobs from '../services/jobs.js';
import { previewScript } from '../services/scriptImport.js';
import { ingestImageUpload, getMedia } from '../services/media.js';
import { diagnostics, storageUsage, isAdmin } from '../services/system.js';
import { runSafeChecks, saveReport, loadReport } from '../flow-lab/lab.js';
import { audit } from '../services/audit.js';
import { RateLimiter } from '../lib/ratelimit.js';

const UPLOAD_SOURCES = ['UPLOAD', 'EXTERNAL', 'FOLDER'];

export function registerRoutes(router, deps) {
  const { db } = deps;
  const uploadLimiter = new RateLimiter({ windowMs: 60_000, max: 120 });
  const labLimiter = new RateLimiter({ windowMs: 60_000, max: 3 });

  const body = (req, limit) => readJson(req, limit);
  const q = (url) => Object.fromEntries(url.searchParams);

  async function upload(req, c, { projectId, source }) {
    if (!uploadLimiter.hit(c.userId)) throw tooMany();
    const len = Number(req.headers['content-length'] || 0);
    if (len > deps.config.maxUploadBytes) throw tooLarge();
    let filename = '';
    try { filename = decodeURIComponent(String(req.headers['x-file-name'] || '')).slice(0, 300); } catch { throw badRequest('Invalid file name header.'); }
    return ingestImageUpload(c, deps, { stream: req, declaredMime: req.headers['content-type'], filename, projectId, source });
  }

  // ---------- Projects ----------
  router.get('/api/projects', (req, c, { url }) => projects.listProjects(db, c, q(url)));
  router.post('/api/projects', async (req, c) => projects.createProject(db, c, await body(req)));
  router.get('/api/projects/:id', (req, c, { params }) => ({
    project: projects.getProject(db, c, params.id), workflow: projects.workflowStatus(db, c, params.id),
  }));
  router.patch('/api/projects/:id', async (req, c, { params }) => projects.updateProject(db, c, params.id, await body(req)));
  router.post('/api/projects/:id/duplicate', (req, c, { params }) => projects.duplicateProject(db, c, params.id));
  router.post('/api/projects/:id/archive', (req, c, { params }) => projects.setArchived(db, c, params.id, true));
  router.post('/api/projects/:id/unarchive', (req, c, { params }) => projects.setArchived(db, c, params.id, false));
  router.get('/api/projects/:id/workflow', (req, c, { params }) => projects.workflowStatus(db, c, params.id));

  // ---------- Scenes ----------
  router.get('/api/projects/:id/scenes', (req, c, { params, url }) => ({ items: scenes.listScenes(db, c, params.id, q(url)) }));
  router.post('/api/projects/:id/scenes', async (req, c, { params }) => scenes.createScene(db, c, params.id, await body(req)));
  router.put('/api/projects/:id/scene-order', async (req, c, { params }) => ({ items: scenes.reorderScenes(db, c, params.id, (await body(req)).sceneIds) }));
  router.get('/api/scenes/:id', (req, c, { params }) => ({ scene: scenes.getScene(db, c, params.id), candidates: images.listCandidates(db, c, params.id) }));
  router.patch('/api/scenes/:id', async (req, c, { params }) => scenes.updateScene(db, c, params.id, await body(req)));
  router.post('/api/scenes/:id/duplicate', (req, c, { params }) => scenes.duplicateScene(db, c, params.id));
  router.delete('/api/scenes/:id', (req, c, { params }) => { scenes.removeScene(db, c, params.id); return { ok: true }; });
  router.post('/api/scenes/:id/skip', async (req, c, { params }) => scenes.setSkipped(db, c, params.id, (await body(req)).skipped !== false));
  router.post('/api/scenes/:id/retry', (req, c, { params }) => {
    const j = db.prepare(`SELECT id FROM jobs WHERE scene_id = ? AND tenant_id = ? AND state IN ('FAILED','INTERRUPTED') ORDER BY created_at DESC LIMIT 1`).get(params.id, c.tenantId);
    if (!j) throw notFound('Failed job for this scene');
    return jobs.retryJob(db, c, j.id);
  });

  // ---------- Master Script importer ----------
  router.post('/api/projects/:id/script/preview', async (req, c, { params }) => {
    const p = projects.getProject(db, c, params.id);
    const { text } = await body(req, 3 * 1024 * 1024);
    return previewScript(text, { defaultDuration: p.scene_duration_sec, defaultAspect: p.aspect_ratio });
  }, { limitKey: 'script' });
  router.post('/api/projects/:id/script/import', async (req, c, { params }) => {
    const p = projects.getProject(db, c, params.id);
    const { text, confirm } = await body(req, 3 * 1024 * 1024);
    if (confirm !== true) throw badRequest('Import requires explicit confirmation.');
    // Re-validate server-side: the (possibly corrected) script must be error-free.
    const preview = previewScript(text, { defaultDuration: p.scene_duration_sec, defaultAspect: p.aspect_ratio });
    if (!preview.canImport) return { imported: 0, preview };
    const ids = scenes.insertScenes(db, c, params.id, preview.scenes.map((s) => s.draft));
    audit(db, c, 'script.import', 'project', params.id, { scenes: ids.length, format: preview.format });
    return { imported: ids.length, sceneIds: ids };
  });

  // ---------- Images ----------
  router.get('/api/scenes/:id/candidates', (req, c, { params }) => ({ items: images.listCandidates(db, c, params.id) }));
  router.post('/api/scenes/:id/candidates', async (req, c, { params, url }) => {
    const source = url.searchParams.get('source') || 'UPLOAD';
    if (!UPLOAD_SOURCES.includes(source)) throw badRequest('Unknown image source.');
    const scene = scenes.getScene(db, c, params.id);
    const media = await upload(req, c, { projectId: scene.project_id, source });
    const cand = images.addCandidate(db, c, scene.id, media.id, source);
    return images.listCandidates(db, c, scene.id).find((x) => x.id === cand.id);
  }, { raw: true });
  router.post('/api/scenes/:id/candidates/from-asset', async (req, c, { params }) => {
    const { assetId } = validate(await body(req), { assetId: { type: 'id', required: true } });
    return images.candidateFromAsset(db, c, params.id, assetId);
  });
  router.post('/api/candidates/:id/approve', async (req, c, { params }) => images.approveCandidate(db, c, params.id, { replaceApproved: (await body(req)).replaceApproved === true }));
  router.post('/api/candidates/:id/reject', async (req, c, { params }) => images.rejectCandidate(db, c, params.id, { confirmApproved: (await body(req)).confirmApproved === true }));
  router.post('/api/projects/:id/image-mapping/preview', async (req, c, { params }) => {
    const { filenames } = validate(await body(req), { filenames: { type: 'array', required: true, max: 1000 } });
    return images.previewImageMapping(scenes.listScenes(db, c, params.id), filenames.map(String));
  });

  // ---------- Media (authenticated, tenant-scoped) ----------
  router.get('/api/media/:id', (req, c, { params, url, res }) => {
    const m = getMedia(db, c, params.id);
    const key = url.searchParams.get('size') === 'thumb' && m.thumb_key ? m.thumb_key : m.storage_key;
    const file = deps.storage.pathForKey(key);
    let st;
    try { st = fs.statSync(file); } catch { throw notFound('Media file'); }
    const etag = `"${m.sha256.slice(0, 32)}${key === m.thumb_key ? '-t' : ''}"`;
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${m.id}.${m.mime.split('/')[1] === 'jpeg' ? 'jpg' : m.mime.split('/')[1]}"`);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return undefined; }
    res.writeHead(200, { 'Content-Type': key === m.thumb_key ? 'image/jpeg' : m.mime, 'Content-Length': st.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    return undefined;
  });

  // ---------- Libraries ----------
  for (const [kind, base] of [['character', '/api/characters'], ['asset', '/api/assets']]) {
    router.get(base, (req, c, { url }) => {
      const o = q(url);
      return library.listLibrary(db, c, kind, { ...o, archived: o.archived === 'true' });
    });
    router.post(base, async (req, c) => library.createLibraryItem(db, c, kind, await body(req)));
    router.get(`${base}/:id`, (req, c, { params }) => library.getLibraryItem(db, c, kind, params.id));
    router.patch(`${base}/:id`, async (req, c, { params }) => library.updateLibraryItem(db, c, kind, params.id, await body(req)));
    router.post(`${base}/:id/archive`, (req, c, { params }) => library.setLibraryArchived(db, c, kind, params.id, true));
    router.post(`${base}/:id/unarchive`, (req, c, { params }) => library.setLibraryArchived(db, c, kind, params.id, false));
    router.post(`${base}/:id/projects`, async (req, c, { params }) => {
      const d = validate(await body(req), { projectId: { type: 'id', required: true }, linked: { type: 'bool', default: true } });
      return library.linkToProject(db, c, kind, params.id, d.projectId, d.linked);
    });
    router.post(`${base}/:id/images`, async (req, c, { params }) => {
      library.getLibraryItem(db, c, kind, params.id);
      const media = await upload(req, c, { projectId: null, source: 'UPLOAD' });
      return library.attachLibraryImage(db, c, kind, params.id, media.id);
    }, { raw: true });
  }

  // ---------- Generation / jobs ----------
  router.get('/api/providers', () => ({ items: deps.providers.list() }));
  router.post('/api/projects/:id/generation', async (req, c, { params }) => jobs.enqueueImageRun(db, c, deps.providers, params.id, await body(req)));
  router.get('/api/projects/:id/generation', (req, c, { params }) => ({ runs: jobs.listRuns(db, c, params.id) }));
  router.get('/api/runs/:id', (req, c, { params }) => jobs.runSummary(db, c, params.id));
  router.post('/api/runs/:id/pause', (req, c, { params }) => jobs.pauseRun(db, c, params.id));
  router.post('/api/runs/:id/resume', (req, c, { params }) => jobs.resumeRun(db, c, params.id));
  router.post('/api/runs/:id/cancel', (req, c, { params }) => jobs.cancelRun(db, c, params.id));
  router.get('/api/jobs', (req, c, { url }) => jobs.listJobs(db, c, q(url)));
  for (const action of ['retry', 'pause', 'resume', 'skip', 'cancel']) {
    const fn = jobs[`${action}Job`];
    router.post(`/api/jobs/:id/${action}`, (req, c, { params }) => fn(db, c, params.id));
  }

  // ---------- System ----------
  router.get('/api/system/diagnostics', (req, c) => diagnostics(c, deps));
  router.get('/api/system/storage', (req, c) => storageUsage(c, deps));
  router.get('/api/flow-lab', (req, c) => {
    if (!isAdmin(c)) throw forbidden();
    return { report: loadReport(deps.config), productionAutomationEnabled: false };
  });
  router.post('/api/flow-lab/run', async (req, c) => {
    if (!isAdmin(c)) throw forbidden();
    if (!labLimiter.hit(c.tenantId)) throw tooMany();
    const { checkReachability } = await body(req);
    const report = await runSafeChecks(deps.config, { checkReachability: checkReachability === true });
    saveReport(deps.config, report);
    audit(db, c, 'flowlab.run', null, null, { reachability: checkReachability === true });
    return { report, productionAutomationEnabled: false };
  });
  router.get('/api/flow-accounts', (req, c) => ({
    items: db.prepare('SELECT id, provider, label, status, is_selected, last_checked_at FROM provider_accounts WHERE tenant_id = ? ORDER BY created_at').all(c.tenantId),
    enabled: false,
    note: 'Flow account management will be enabled after the Flow Feasibility Lab is validated.',
  }));
}
