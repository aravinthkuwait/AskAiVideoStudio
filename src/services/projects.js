// Projects. Every query is scoped by tenant_id taken from the authenticated
// session (never from the request body).
import { newId, nowIso } from '../lib/ids.js';
import { validate, ASPECT_RATIOS } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { transaction } from '../persistence/database.js';
import { audit } from './audit.js';

export const PROJECT_SCHEMA = {
  title: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 5000, default: '' },
  aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, default: '16:9' },
  scene_duration_sec: { type: 'int', min: 1, max: 600, default: 10 },
};

const COLUMNS = `p.id, p.title, p.description, p.aspect_ratio, p.scene_duration_sec, p.status, p.thumbnail_media_id,
  p.owner_id, p.tenant_id, p.created_at, p.updated_at, p.archived_at`;

export function getProject(db, ctx, id) {
  const row = db.prepare(`SELECT ${COLUMNS} FROM projects p WHERE p.id = ? AND p.tenant_id = ?`).get(id, ctx.tenantId);
  if (!row) throw notFound('Project');
  return row;
}

export function listProjects(db, ctx, { status = 'ACTIVE', limit = 24, offset = 0, q = '' } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const st = status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  const like = `%${String(q).slice(0, 100).replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const items = db.prepare(`SELECT ${COLUMNS},
      (SELECT COUNT(*) FROM scenes s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS scene_count,
      (SELECT COUNT(*) FROM scenes s WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.image_status = 'APPROVED') AS approved_count
    FROM projects p WHERE p.tenant_id = ? AND p.status = ? AND p.title LIKE ? ESCAPE '\\'
    ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`).all(ctx.tenantId, st, like, lim + 1, off);
  return { items: items.slice(0, lim), hasMore: items.length > lim, offset: off, limit: lim };
}

export function createProject(db, ctx, input) {
  const data = validate(input, PROJECT_SCHEMA);
  const id = newId();
  const now = nowIso();
  db.prepare(`INSERT INTO projects (id, tenant_id, owner_id, title, description, aspect_ratio, scene_duration_sec, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.tenantId, ctx.userId, data.title, data.description, data.aspect_ratio, data.scene_duration_sec, now, now);
  audit(db, ctx, 'project.create', 'project', id);
  return getProject(db, ctx, id);
}

export function updateProject(db, ctx, id, input) {
  getProject(db, ctx, id);
  const data = validate(input, PROJECT_SCHEMA, { partial: true });
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(...keys.map((k) => data[k]), nowIso(), id, ctx.tenantId);
    audit(db, ctx, 'project.update', 'project', id, { fields: keys });
  }
  return getProject(db, ctx, id);
}

export function touchProject(db, ctx, id) {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ? AND tenant_id = ?').run(nowIso(), id, ctx.tenantId);
}

/** Soft archive — nothing is deleted. */
export function setArchived(db, ctx, id, archived) {
  getProject(db, ctx, id);
  db.prepare(`UPDATE projects SET status = ?, archived_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
    .run(archived ? 'ARCHIVED' : 'ACTIVE', archived ? nowIso() : null, nowIso(), id, ctx.tenantId);
  audit(db, ctx, archived ? 'project.archive' : 'project.unarchive', 'project', id);
  return getProject(db, ctx, id);
}

const SCENE_COPY_COLS = ['scene_code', 'title', 'description', 'characters', 'location', 'assets', 'image_prompt', 'video_prompt',
  'dialogue', 'camera', 'lighting', 'audio_notes', 'bgm_notes', 'sfx_notes', 'negative_prompt', 'continuity_notes',
  'duration_sec', 'aspect_ratio', 'extra_json', 'image_source'];

/** Duplicates project metadata + scene text. Media/approvals are NOT copied (statuses reset). */
export function duplicateProject(db, ctx, id) {
  const src = getProject(db, ctx, id);
  return transaction(db, () => {
    const copyId = newId();
    const now = nowIso();
    db.prepare(`INSERT INTO projects (id, tenant_id, owner_id, title, description, aspect_ratio, scene_duration_sec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(copyId, ctx.tenantId, ctx.userId, `${src.title} (copy)`.slice(0, 200), src.description,
      src.aspect_ratio, src.scene_duration_sec, now, now);
    const scenes = db.prepare(`SELECT position, ${SCENE_COPY_COLS.join(', ')} FROM scenes WHERE project_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY position`).all(id, ctx.tenantId);
    const ins = db.prepare(`INSERT INTO scenes (id, tenant_id, project_id, position, ${SCENE_COPY_COLS.join(', ')}, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${SCENE_COPY_COLS.map(() => '?').join(', ')}, ?, ?)`);
    for (const s of scenes) ins.run(newId(), ctx.tenantId, copyId, s.position, ...SCENE_COPY_COLS.map((c) => s[c]), now, now);
    db.prepare('INSERT INTO project_characters (project_id, character_id, tenant_id) SELECT ?, character_id, tenant_id FROM project_characters WHERE project_id = ? AND tenant_id = ?').run(copyId, id, ctx.tenantId);
    db.prepare('INSERT INTO project_assets (project_id, asset_id, tenant_id) SELECT ?, asset_id, tenant_id FROM project_assets WHERE project_id = ? AND tenant_id = ?').run(copyId, id, ctx.tenantId);
    audit(db, ctx, 'project.duplicate', 'project', copyId, { from: id });
    return getProject(db, ctx, copyId);
  });
}

/** 10-step workflow indicator derived from real state (never faked). */
export function workflowStatus(db, ctx, projectId) {
  const q = (sql) => db.prepare(sql).get(projectId, ctx.tenantId);
  const sc = q(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN image_status IN ('CANDIDATES','APPROVED','REJECTED','SKIPPED') OR EXISTS (SELECT 1 FROM image_candidates c WHERE c.scene_id = s.id) THEN 1 ELSE 0 END) AS with_images,
      SUM(CASE WHEN image_status IN ('APPROVED','SKIPPED') THEN 1 ELSE 0 END) AS reviewed,
      SUM(CASE WHEN image_status = 'FAILED' THEN 1 ELSE 0 END) AS failed
    FROM scenes s WHERE project_id = ? AND tenant_id = ? AND deleted_at IS NULL`);
  const chars = q('SELECT COUNT(*) AS n FROM project_characters WHERE project_id = ? AND tenant_id = ?').n;
  const total = sc.total || 0;
  const raw = [
    ['SCRIPT', total > 0 ? 'completed' : 'pending'],
    ['CHARACTERS', chars > 0 ? 'completed' : 'pending'],
    ['IMAGES', sc.failed > 0 ? 'failed' : (total > 0 && sc.with_images === total ? 'completed' : 'pending')],
    ['REVIEW', total > 0 && sc.reviewed === total ? 'completed' : 'pending'],
    ['VIDEOS', 'pending'], ['EDIT', 'pending'], ['AUDIO', 'pending'],
    ['SUBTITLES', 'pending'], ['THUMBNAIL', 'pending'], ['EXPORT', 'pending'],
  ];
  // CHARACTERS is optional: it never blocks the "current" marker.
  const currentIdx = raw.findIndex(([k, s]) => s !== 'completed' && k !== 'CHARACTERS');
  return {
    steps: raw.map(([key, state], i) => ({ n: i + 1, key, state: state === 'pending' && i === currentIdx ? 'current' : state, available: i < 4 })),
    counts: { scenes: total, withImages: sc.with_images || 0, reviewed: sc.reviewed || 0, failed: sc.failed || 0, characters: chars },
  };
}
