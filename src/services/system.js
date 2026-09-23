// Diagnostics + storage usage. Infrastructure details are ADMIN-ONLY.
import fs from 'node:fs';
import path from 'node:path';
import { findChrome, findFfmpeg, toolVersion } from '../lib/tools.js';
import { queueStats } from './jobs.js';
import { forbidden } from '../lib/errors.js';

export const isAdmin = (ctx) => ctx.role === 'owner' || ctx.role === 'admin';

let toolCache = null;
async function tools(config) {
  if (toolCache && Date.now() - toolCache.at < 5 * 60 * 1000) return toolCache.value;
  const ffmpeg = findFfmpeg(config.ffmpegPath);
  const chrome = findChrome(config.chromePath);
  const value = {
    ffmpeg: { available: !!ffmpeg, version: await toolVersion(ffmpeg, ['-version']) },
    browser: { available: !!chrome, version: await toolVersion(chrome) },
  };
  toolCache = { at: Date.now(), value };
  return value;
}

export async function diagnostics(ctx, { db, config, worker, startedAt }) {
  if (!isAdmin(ctx)) throw forbidden();
  let dbOk = false;
  try { dbOk = db.prepare('SELECT 1 AS ok').get().ok === 1; } catch { /* false */ }
  let disk = null;
  try {
    const s = fs.statfsSync(config.privateRoot);
    disk = { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch { /* unknown */ }
  const t = await tools(config);
  return {
    application: { status: 'ok', version: '0.1.0', uptimeSec: Math.round((Date.now() - startedAt) / 1000), node: process.version, env: config.nodeEnv },
    database: { status: dbOk ? 'ok' : 'error' },
    worker: config.workerMode === 'embedded' && worker ? { mode: 'embedded', ...worker.status() } : { mode: config.workerMode },
    queue: queueStats(db),
    disk,
    ffmpeg: t.ffmpeg,
    browserWorker: { ...t.browser, flowAutomationEnabled: false },
  };
}

function dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p); else if (e.isFile()) total += fs.statSync(p).size;
    }
  }
  return total;
}

/** Storage usage for the caller's tenant (from the database — never another tenant's data). */
export function storageUsage(ctx, { db, config }) {
  const byKind = db.prepare(`SELECT kind, COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS bytes FROM media WHERE tenant_id = ? GROUP BY kind`).all(ctx.tenantId);
  const byProject = db.prepare(`SELECT p.id, p.title, COUNT(m.id) AS files, COALESCE(SUM(m.bytes), 0) AS bytes FROM projects p
    LEFT JOIN media m ON m.project_id = p.id AND m.tenant_id = p.tenant_id WHERE p.tenant_id = ? GROUP BY p.id ORDER BY bytes DESC LIMIT 50`).all(ctx.tenantId);
  const kinds = Object.fromEntries(['image', 'video', 'audio'].map((k) => [k, byKind.find((r) => r.kind === k) || { kind: k, files: 0, bytes: 0 }]));
  const out = { images: kinds.image, videos: kinds.video, audio: kinds.audio, exports: { files: 0, bytes: 0 }, projects: byProject };
  if (isAdmin(ctx)) out.temporaryBytes = dirBytes(path.join(config.privateRoot, 'temp'));
  return out;
}
