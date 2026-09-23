// Media ingestion. Uploaded bytes are streamed to private temp storage,
// content-sniffed, and copied under a server-generated name. The original
// external file is never modified; user filenames are kept for display only.
import fs from 'node:fs';
import nodeCrypto from 'node:crypto';
import { newId, nowIso } from '../lib/ids.js';
import { checkImage, imageSize } from '../lib/filetype.js';
import { safeDisplayName } from '../lib/storage.js';
import { unsupported, notFound } from '../lib/errors.js';

/** Stream an image upload into storage and create a media row. */
export async function ingestImageUpload(ctx, deps, { stream, declaredMime, filename, projectId, source }) {
  const { db, storage, config, thumbnailer } = deps;
  const received = await storage.receiveToTemp(stream, config.maxUploadBytes);
  try {
    const check = checkImage(received.head, declaredMime, filename);
    if (!check.ok) throw unsupported(check.reason);
    const header = Buffer.alloc(Math.min(received.bytes, 256 * 1024));
    const fd = fs.openSync(received.tempPath, 'r');
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    const { width, height } = imageSize(header, check.kind);
    const mediaId = newId();
    const key = storage.mediaKey(ctx.tenantId, projectId, mediaId, check.ext);
    storage.commitTemp(received.tempPath, key);
    db.prepare(`INSERT INTO media (id, tenant_id, project_id, kind, storage_key, mime, bytes, sha256, width, height, original_filename, source, created_by, created_at)
      VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(mediaId, ctx.tenantId, projectId ?? null, key, check.mime, received.bytes,
      received.sha256, width, height, filename ? safeDisplayName(filename) : null, source, ctx.userId ?? null, nowIso());
    thumbnailer?.schedule(ctx.tenantId, mediaId);
    return getMedia(db, ctx, mediaId);
  } finally {
    fs.rmSync(received.tempPath, { force: true });
  }
}

/** Store a server-generated image buffer (e.g. SIMULATED provider output). */
export function ingestImageBuffer(ctx, deps, { buffer, mime, ext, projectId, source, width, height, label }) {
  const { db, storage } = deps;
  const mediaId = newId();
  const key = storage.mediaKey(ctx.tenantId, projectId, mediaId, ext);
  storage.writeBuffer(key, buffer);
  db.prepare(`INSERT INTO media (id, tenant_id, project_id, kind, storage_key, mime, bytes, sha256, width, height, original_filename, source, created_by, created_at)
    VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(mediaId, ctx.tenantId, projectId ?? null, key, mime, buffer.length,
    sha256Buf(buffer), width ?? null, height ?? null, label ?? null, source, ctx.userId ?? null, nowIso());
  return getMedia(db, ctx, mediaId);
}

const sha256Buf = (b) => nodeCrypto.createHash('sha256').update(b).digest('hex');

export function getMedia(db, ctx, id) {
  const row = db.prepare('SELECT * FROM media WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
  if (!row) throw notFound('Media');
  return row;
}

/** Public (API) view of a media row — never exposes storage paths. */
export function mediaView(m) {
  if (!m) return null;
  return {
    id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, width: m.width, height: m.height,
    originalFilename: m.original_filename, source: m.source, createdAt: m.created_at,
    url: `/api/media/${m.id}`, thumbUrl: `/api/media/${m.id}?size=thumb`,
  };
}
