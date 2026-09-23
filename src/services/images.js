// Image candidates per scene + approval. Approved images are PROTECTED:
// nothing replaces an approved image automatically; switching requires an
// explicit user action with replaceApproved=true. Alternatives are preserved.
import { newId, nowIso } from '../lib/ids.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { transaction } from '../persistence/database.js';
import { getScene } from './scenes.js';
import { getMedia, mediaView } from './media.js';
import { audit } from './audit.js';
import { touchProject } from './projects.js';

export const CANDIDATE_SOURCES = ['FLOW', 'EXTERNAL', 'UPLOAD', 'FOLDER', 'ASSET', 'SIMULATED'];

export function addCandidate(db, ctx, sceneId, mediaId, source, { jobId = null } = {}) {
  if (!CANDIDATE_SOURCES.includes(source)) throw badRequest('Unknown image source.');
  return transaction(db, () => {
    const scene = getScene(db, ctx, sceneId);
    getMedia(db, ctx, mediaId); // tenant check
    if (jobId) {
      const existing = db.prepare('SELECT id FROM image_candidates WHERE job_id = ? AND tenant_id = ?').get(jobId, ctx.tenantId);
      if (existing) return getCandidate(db, ctx, existing.id); // idempotent retry
    }
    const id = newId();
    db.prepare(`INSERT INTO image_candidates (id, tenant_id, project_id, scene_id, media_id, source, job_id, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.tenantId, scene.project_id, sceneId, mediaId, source, jobId, nowIso());
    // A new candidate never changes an APPROVED or SKIPPED scene.
    if (!['APPROVED', 'SKIPPED'].includes(scene.image_status)) {
      db.prepare(`UPDATE scenes SET image_status = 'CANDIDATES', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(nowIso(), sceneId, ctx.tenantId);
    }
    touchProject(db, ctx, scene.project_id);
    audit(db, ctx, 'candidate.add', 'scene', sceneId, { source, candidateId: id });
    return getCandidate(db, ctx, id);
  });
}

export function getCandidate(db, ctx, id) {
  const row = db.prepare('SELECT * FROM image_candidates WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
  if (!row) throw notFound('Image candidate');
  return row;
}

export function listCandidates(db, ctx, sceneId) {
  getScene(db, ctx, sceneId);
  return db.prepare(`SELECT c.*, m.mime, m.bytes, m.width, m.height, m.original_filename, m.created_at AS media_created_at, m.kind, m.source AS media_source
    FROM image_candidates c JOIN media m ON m.id = c.media_id AND m.tenant_id = c.tenant_id
    WHERE c.scene_id = ? AND c.tenant_id = ? ORDER BY (c.status = 'APPROVED') DESC, c.imported_at DESC`).all(sceneId, ctx.tenantId)
    .map(candidateView);
}

export function candidateView(c) {
  return {
    id: c.id, sceneId: c.scene_id, source: c.source, status: c.status, jobId: c.job_id, importedAt: c.imported_at, decidedAt: c.decided_at,
    media: mediaView({ id: c.media_id, kind: c.kind || 'image', mime: c.mime, bytes: c.bytes, width: c.width, height: c.height,
      original_filename: c.original_filename, source: c.media_source || c.source, created_at: c.media_created_at }),
  };
}

/** "USE THIS IMAGE". */
export function approveCandidate(db, ctx, candidateId, { replaceApproved = false } = {}) {
  return transaction(db, () => {
    const cand = getCandidate(db, ctx, candidateId);
    const scene = getScene(db, ctx, cand.scene_id);
    if (cand.status === 'APPROVED') return cand;
    if (scene.approved_candidate_id && scene.approved_candidate_id !== cand.id) {
      if (!replaceApproved) {
        throw conflict('This scene already has an approved image. Confirm that you want to replace it (the current one will be kept as an alternative).', { approvedCandidateId: scene.approved_candidate_id });
      }
      db.prepare(`UPDATE image_candidates SET status = 'CANDIDATE', decided_at = ?, decided_by = ? WHERE id = ? AND tenant_id = ?`)
        .run(nowIso(), ctx.userId, scene.approved_candidate_id, ctx.tenantId);
    }
    db.prepare(`UPDATE image_candidates SET status = 'APPROVED', decided_at = ?, decided_by = ? WHERE id = ? AND tenant_id = ?`).run(nowIso(), ctx.userId, cand.id, ctx.tenantId);
    db.prepare(`UPDATE scenes SET approved_candidate_id = ?, image_status = 'APPROVED', updated_at = ? WHERE id = ? AND tenant_id = ?`).run(cand.id, nowIso(), scene.id, ctx.tenantId);
    touchProject(db, ctx, scene.project_id);
    audit(db, ctx, 'candidate.approve', 'scene', scene.id, { candidateId: cand.id, replaced: scene.approved_candidate_id || null });
    return getCandidate(db, ctx, cand.id);
  });
}

/** Reject a candidate (kept on record; never deleted). Rejecting the approved one requires confirmation. */
export function rejectCandidate(db, ctx, candidateId, { confirmApproved = false } = {}) {
  return transaction(db, () => {
    const cand = getCandidate(db, ctx, candidateId);
    const scene = getScene(db, ctx, cand.scene_id);
    if (cand.status === 'APPROVED' && !confirmApproved) throw conflict('This is the approved image. Confirm to un-approve and reject it.');
    db.prepare(`UPDATE image_candidates SET status = 'REJECTED', decided_at = ?, decided_by = ? WHERE id = ? AND tenant_id = ?`).run(nowIso(), ctx.userId, cand.id, ctx.tenantId);
    if (scene.approved_candidate_id === cand.id) {
      db.prepare('UPDATE scenes SET approved_candidate_id = NULL WHERE id = ? AND tenant_id = ?').run(scene.id, ctx.tenantId);
    }
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM image_candidates WHERE scene_id = ? AND tenant_id = ? AND status != 'REJECTED'`).get(scene.id, ctx.tenantId).n;
    const approvedLeft = scene.approved_candidate_id && scene.approved_candidate_id !== cand.id;
    const status = scene.image_status === 'SKIPPED' ? 'SKIPPED' : approvedLeft ? 'APPROVED' : remaining > 0 ? 'CANDIDATES' : 'REJECTED';
    db.prepare('UPDATE scenes SET image_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, nowIso(), scene.id, ctx.tenantId);
    audit(db, ctx, 'candidate.reject', 'scene', scene.id, { candidateId: cand.id });
    return getCandidate(db, ctx, cand.id);
  });
}

/**
 * Filename → scene mapping for bulk external/ChatGPT imports. Matches
 * "Scene_001.png", "scene-2.jpg", "S003.webp", "003.png" or an exact SCENE_ID.
 * Returns a PREVIEW only; files are uploaded after the user confirms.
 */
export function previewImageMapping(scenes, filenames) {
  const byCode = new Map(scenes.filter((s) => s.scene_code).map((s) => [s.scene_code.toLowerCase(), s]));
  const byNumber = new Map(scenes.map((s) => [s.position, s]));
  const used = new Map();
  const rows = filenames.slice(0, 1000).map((name) => {
    const display = String(name).split(/[\\/]/).pop().slice(0, 200);
    const stem = display.replace(/\.[^.]+$/, '');
    let scene = byCode.get(stem.toLowerCase()) || null;
    let rule = scene ? 'SCENE_ID' : null;
    if (!scene) {
      const m = stem.match(/^(?:scene|sc|s)?[\s_-]*0*(\d{1,4})(?:\D.*)?$/i);
      if (m) { scene = byNumber.get(Number(m[1])) || null; rule = scene ? 'NUMBER' : null; }
    }
    const ext = display.toLowerCase().split('.').pop();
    const supported = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
    const row = { filename: display, sceneId: supported ? scene?.id ?? null : null, scenePosition: scene?.position ?? null,
      sceneTitle: scene?.title ?? null, rule, issue: null };
    if (!supported) row.issue = 'Unsupported file type (PNG, JPEG, WebP only).';
    else if (!scene) row.issue = 'No matching scene — choose one manually or skip.';
    else if (used.has(scene.id)) row.issue = `Also matches ${used.get(scene.id)} — both will be added as candidates.`;
    if (scene && supported) used.set(scene.id, display);
    if (scene?.image_status === 'APPROVED' && !row.issue) row.issue = 'Scene already has an approved image — this will be added as an alternative, not a replacement.';
    return row;
  });
  return { rows, matched: rows.filter((r) => r.sceneId).length, unmatched: rows.filter((r) => !r.sceneId).length };
}

/** Use an existing library asset / project media as a candidate (media is immutable, so it is referenced, not copied). */
export function candidateFromAsset(db, ctx, sceneId, assetId) {
  const asset = db.prepare('SELECT * FROM library_assets WHERE id = ? AND tenant_id = ? AND archived_at IS NULL').get(assetId, ctx.tenantId);
  if (!asset) throw notFound('Asset');
  if (!asset.preview_media_id) throw badRequest('This asset has no image.');
  return addCandidate(db, ctx, sceneId, asset.preview_media_id, 'ASSET');
}
