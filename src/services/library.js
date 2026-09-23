// Character Library + Asset Library (tenant-wide, reusable across projects).
import { newId, nowIso } from '../lib/ids.js';
import { validate } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { getProject } from './projects.js';
import { getMedia, mediaView } from './media.js';
import { audit } from './audit.js';

const T = (max) => ({ type: 'string', max, default: '' });
export const CHARACTER_SCHEMA = {
  name: { type: 'string', required: true, min: 1, max: 120 },
  role: T(200), description: T(5000), appearance: T(5000), costume: T(5000), continuity: T(5000), voice_notes: T(2000),
};
export const ASSET_CATEGORIES = ['VEHICLE', 'LOCATION', 'PROP', 'LOGO', 'REFERENCE'];
export const ASSET_SCHEMA = {
  name: { type: 'string', required: true, min: 1, max: 120 },
  category: { type: 'string', required: true, enum: ASSET_CATEGORIES },
  description: T(5000),
};

const LIB = {
  character: { table: 'characters', schema: CHARACTER_SCHEMA, link: 'project_characters', linkCol: 'character_id', label: 'Character' },
  asset: { table: 'library_assets', schema: ASSET_SCHEMA, link: 'project_assets', linkCol: 'asset_id', label: 'Asset' },
};

function get(db, ctx, kind, id) {
  const { table, label } = LIB[kind];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`).get(id, ctx.tenantId);
  if (!row) throw notFound(label);
  return row;
}

export function listLibrary(db, ctx, kind, { q = '', category = '', projectId = '', archived = false, limit = 60, offset = 0 } = {}) {
  const { table, link, linkCol } = LIB[kind];
  const where = ['t.tenant_id = ?', archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL'];
  const args = [ctx.tenantId];
  if (q) { where.push(`t.name LIKE ? ESCAPE '\\'`); args.push(`%${String(q).slice(0, 100).replace(/[%_\\]/g, (m) => '\\' + m)}%`); }
  if (kind === 'asset' && ASSET_CATEGORIES.includes(category)) { where.push('t.category = ?'); args.push(category); }
  if (projectId) { where.push(`EXISTS (SELECT 1 FROM ${link} l WHERE l.${linkCol} = t.id AND l.project_id = ? AND l.tenant_id = t.tenant_id)`); args.push(projectId); }
  const lim = Math.min(Math.max(Number(limit) || 60, 1), 200);
  const rows = db.prepare(`SELECT t.* FROM ${table} t WHERE ${where.join(' AND ')} ORDER BY t.name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...args, lim + 1, Math.max(Number(offset) || 0, 0));
  return { items: rows.slice(0, lim).map((r) => view(db, ctx, kind, r)), hasMore: rows.length > lim };
}

function view(db, ctx, kind, row) {
  const { link, linkCol } = LIB[kind];
  const projects = db.prepare(`SELECT p.id, p.title FROM ${link} l JOIN projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
    WHERE l.${linkCol} = ? AND l.tenant_id = ?`).all(row.id, ctx.tenantId);
  const out = { ...row, projects };
  if (kind === 'character') {
    out.images = db.prepare(`SELECT m.* FROM character_images ci JOIN media m ON m.id = ci.media_id AND m.tenant_id = ci.tenant_id
      WHERE ci.character_id = ? AND ci.tenant_id = ? ORDER BY ci.created_at`).all(row.id, ctx.tenantId).map(mediaView);
  } else {
    out.preview = row.preview_media_id ? mediaView(getMedia(db, ctx, row.preview_media_id)) : null;
  }
  return out;
}

export function getLibraryItem(db, ctx, kind, id) { return view(db, ctx, kind, get(db, ctx, kind, id)); }

export function createLibraryItem(db, ctx, kind, input) {
  const { table, schema } = LIB[kind];
  const data = validate(input, schema);
  const id = newId();
  const now = nowIso();
  const keys = Object.keys(data);
  db.prepare(`INSERT INTO ${table} (id, tenant_id, owner_id, ${keys.join(', ')}, created_at, updated_at) VALUES (?, ?, ?, ${keys.map(() => '?').join(', ')}, ?, ?)`)
    .run(id, ctx.tenantId, ctx.userId, ...keys.map((k) => data[k]), now, now);
  audit(db, ctx, `${kind}.create`, kind, id);
  return getLibraryItem(db, ctx, kind, id);
}

export function updateLibraryItem(db, ctx, kind, id, input) {
  const { table, schema } = LIB[kind];
  get(db, ctx, kind, id);
  const data = validate(input, schema, { partial: true });
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(...keys.map((k) => data[k]), nowIso(), id, ctx.tenantId);
  }
  return getLibraryItem(db, ctx, kind, id);
}

export function setLibraryArchived(db, ctx, kind, id, archived) {
  const { table } = LIB[kind];
  get(db, ctx, kind, id);
  db.prepare(`UPDATE ${table} SET archived_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(archived ? nowIso() : null, nowIso(), id, ctx.tenantId);
  audit(db, ctx, archived ? `${kind}.archive` : `${kind}.unarchive`, kind, id);
  return getLibraryItem(db, ctx, kind, id);
}

export function linkToProject(db, ctx, kind, id, projectId, linked) {
  const { link, linkCol } = LIB[kind];
  get(db, ctx, kind, id);
  getProject(db, ctx, projectId);
  if (linked) db.prepare(`INSERT OR IGNORE INTO ${link} (project_id, ${linkCol}, tenant_id) VALUES (?, ?, ?)`).run(projectId, id, ctx.tenantId);
  else db.prepare(`DELETE FROM ${link} WHERE project_id = ? AND ${linkCol} = ? AND tenant_id = ?`).run(projectId, id, ctx.tenantId);
  return getLibraryItem(db, ctx, kind, id);
}

export function attachLibraryImage(db, ctx, kind, id, mediaId) {
  get(db, ctx, kind, id);
  getMedia(db, ctx, mediaId);
  if (kind === 'character') {
    db.prepare('INSERT OR IGNORE INTO character_images (character_id, media_id, tenant_id, created_at) VALUES (?, ?, ?, ?)').run(id, mediaId, ctx.tenantId, nowIso());
  } else {
    db.prepare('UPDATE library_assets SET preview_media_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(mediaId, nowIso(), id, ctx.tenantId);
  }
  return getLibraryItem(db, ctx, kind, id);
}
