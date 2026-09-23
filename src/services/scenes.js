import { newId, nowIso } from '../lib/ids.js';
import { validate, ASPECT_RATIOS } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { transaction } from '../persistence/database.js';
import { getProject, touchProject } from './projects.js';
import { audit } from './audit.js';

export const IMAGE_SOURCES = ['FLOW', 'EXTERNAL', 'UPLOAD', 'FOLDER', 'ASSET'];
const T = (max) => ({ type: 'string', max, default: '' });

export const SCENE_TEXT_FIELDS = {
  scene_code: T(64), title: T(300), description: T(20000), characters: T(2000), location: T(1000), assets: T(2000),
  image_prompt: T(20000), video_prompt: T(20000), dialogue: T(20000), camera: T(2000), lighting: T(2000),
  audio_notes: T(5000), bgm_notes: T(5000), sfx_notes: T(5000), negative_prompt: T(5000), continuity_notes: T(5000),
};
export const SCENE_SCHEMA = {
  ...SCENE_TEXT_FIELDS,
  duration_sec: { type: 'number', min: 0.5, max: 600 },
  aspect_ratio: { type: 'string', enum: ASPECT_RATIOS },
  image_source: { type: 'string', enum: IMAGE_SOURCES },
};

const LIST_COLS = `s.id, s.project_id, s.position, s.scene_code, s.title, s.characters, s.duration_sec, s.aspect_ratio,
  s.image_source, s.image_status, s.video_status, s.approved_candidate_id, s.updated_at,
  (SELECT COUNT(*) FROM image_candidates c WHERE c.scene_id = s.id AND c.tenant_id = s.tenant_id) AS candidate_count,
  (SELECT c.media_id FROM image_candidates c WHERE c.id = s.approved_candidate_id AND c.tenant_id = s.tenant_id) AS approved_media_id,
  (SELECT c.media_id FROM image_candidates c WHERE c.scene_id = s.id AND c.tenant_id = s.tenant_id AND c.status != 'REJECTED' ORDER BY c.imported_at DESC LIMIT 1) AS latest_media_id,
  (SELECT c.id FROM image_candidates c WHERE c.scene_id = s.id AND c.tenant_id = s.tenant_id AND c.status != 'REJECTED' ORDER BY c.imported_at DESC LIMIT 1) AS latest_candidate_id,
  (SELECT c.status FROM image_candidates c WHERE c.scene_id = s.id AND c.tenant_id = s.tenant_id AND c.status != 'REJECTED' ORDER BY c.imported_at DESC LIMIT 1) AS latest_candidate_status,
  (SELECT j.state FROM jobs j WHERE j.scene_id = s.id AND j.tenant_id = s.tenant_id ORDER BY j.created_at DESC LIMIT 1) AS job_state,
  (SELECT j.progress FROM jobs j WHERE j.scene_id = s.id AND j.tenant_id = s.tenant_id ORDER BY j.created_at DESC LIMIT 1) AS job_progress`;

export function listScenes(db, ctx, projectId, { limit = 500, offset = 0 } = {}) {
  getProject(db, ctx, projectId);
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  return db.prepare(`SELECT ${LIST_COLS} FROM scenes s WHERE s.project_id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL
    ORDER BY s.position LIMIT ? OFFSET ?`).all(projectId, ctx.tenantId, lim, Math.max(Number(offset) || 0, 0));
}

export function getScene(db, ctx, id) {
  const row = db.prepare('SELECT * FROM scenes WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(id, ctx.tenantId);
  if (!row) throw notFound('Scene');
  return { ...row, extra: JSON.parse(row.extra_json || '{}') };
}

function nextPosition(db, ctx, projectId) {
  return (db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM scenes WHERE project_id = ? AND tenant_id = ? AND deleted_at IS NULL').get(projectId, ctx.tenantId).m) + 1;
}

/** Inserts validated scenes at the end of the project. Used by the importer too. */
export function insertScenes(db, ctx, projectId, scenes) {
  const project = getProject(db, ctx, projectId);
  return transaction(db, () => {
    let pos = nextPosition(db, ctx, projectId);
    const now = nowIso();
    const cols = Object.keys(SCENE_TEXT_FIELDS);
    const stmt = db.prepare(`INSERT INTO scenes (id, tenant_id, project_id, position, ${cols.join(', ')}, duration_sec, aspect_ratio, image_source, extra_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?)`);
    const ids = [];
    for (const raw of scenes) {
      const s = validate(raw, SCENE_SCHEMA);
      const id = newId();
      stmt.run(id, ctx.tenantId, projectId, pos++, ...cols.map((c) => s[c] ?? ''), s.duration_sec ?? project.scene_duration_sec,
        s.aspect_ratio ?? project.aspect_ratio, s.image_source ?? 'FLOW', JSON.stringify(raw.extra ?? {}), now, now);
      ids.push(id);
    }
    touchProject(db, ctx, projectId);
    return ids;
  });
}

export function createScene(db, ctx, projectId, input) {
  const [id] = insertScenes(db, ctx, projectId, [input || {}]);
  audit(db, ctx, 'scene.create', 'scene', id);
  return getScene(db, ctx, id);
}

export function updateScene(db, ctx, id, input) {
  const scene = getScene(db, ctx, id);
  const data = validate(input, SCENE_SCHEMA, { partial: true });
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE scenes SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(...keys.map((k) => data[k]), nowIso(), id, ctx.tenantId);
    touchProject(db, ctx, scene.project_id);
  }
  return getScene(db, ctx, id);
}

export function duplicateScene(db, ctx, id) {
  const s = getScene(db, ctx, id);
  return transaction(db, () => {
    db.prepare('UPDATE scenes SET position = position + 1 WHERE project_id = ? AND tenant_id = ? AND position > ? AND deleted_at IS NULL')
      .run(s.project_id, ctx.tenantId, s.position);
    const newIdv = newId();
    const now = nowIso();
    const cols = [...Object.keys(SCENE_TEXT_FIELDS), 'duration_sec', 'aspect_ratio', 'image_source', 'extra_json'];
    db.prepare(`INSERT INTO scenes (id, tenant_id, project_id, position, ${cols.join(', ')}, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`)
      .run(newIdv, ctx.tenantId, s.project_id, s.position + 1, ...cols.map((c) => (c === 'title' ? `${s.title} (copy)`.slice(0, 300) : s[c])), now, now);
    touchProject(db, ctx, s.project_id);
    return getScene(db, ctx, newIdv);
  });
}

/** Reorder: the client must send the COMPLETE list of scene ids for the project. */
export function reorderScenes(db, ctx, projectId, sceneIds) {
  getProject(db, ctx, projectId);
  const { ids } = validate({ ids: sceneIds }, { ids: { type: 'ids', required: true } });
  return transaction(db, () => {
    const existing = db.prepare('SELECT id FROM scenes WHERE project_id = ? AND tenant_id = ? AND deleted_at IS NULL').all(projectId, ctx.tenantId).map((r) => r.id);
    const set = new Set(ids);
    if (set.size !== ids.length || ids.length !== existing.length || !existing.every((id) => set.has(id))) {
      throw badRequest('Scene order must include every scene of the project exactly once.');
    }
    const stmt = db.prepare('UPDATE scenes SET position = ?, updated_at = ? WHERE id = ? AND tenant_id = ?');
    const now = nowIso();
    ids.forEach((id, i) => stmt.run(i + 1, now, id, ctx.tenantId));
    touchProject(db, ctx, projectId);
    audit(db, ctx, 'scene.reorder', 'project', projectId);
    return listScenes(db, ctx, projectId);
  });
}

/** Soft delete (restorable from the database; never removes media). */
export function removeScene(db, ctx, id) {
  const s = getScene(db, ctx, id);
  db.prepare('UPDATE scenes SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(nowIso(), nowIso(), id, ctx.tenantId);
  audit(db, ctx, 'scene.remove', 'scene', id);
  touchProject(db, ctx, s.project_id);
}

export function setSkipped(db, ctx, id, skipped) {
  const s = getScene(db, ctx, id);
  let status = 'SKIPPED';
  if (!skipped) {
    status = s.approved_candidate_id ? 'APPROVED'
      : (db.prepare('SELECT 1 FROM image_candidates WHERE scene_id = ? AND tenant_id = ?').get(id, ctx.tenantId) ? 'CANDIDATES' : 'PENDING');
  }
  db.prepare('UPDATE scenes SET image_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, nowIso(), id, ctx.tenantId);
  audit(db, ctx, skipped ? 'scene.skip' : 'scene.unskip', 'scene', id);
  return getScene(db, ctx, id);
}
