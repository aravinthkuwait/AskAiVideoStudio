// Optional thumbnail generation with an EXISTING ffmpeg (never installed or
// modified by this app). Bounded queue, one process at a time, hard timeout.
// Without ffmpeg the UI falls back to lazy-loaded, CSS-scaled originals.
import fs from 'node:fs';
import { run } from './tools.js';

export class Thumbnailer {
  constructor({ db, storage, ffmpeg, logger }) {
    this.db = db; this.storage = storage; this.ffmpeg = ffmpeg; this.log = logger?.child('thumbs');
    this.queue = []; this.running = false;
  }
  get enabled() { return !!this.ffmpeg; }
  schedule(tenantId, mediaId) {
    if (!this.enabled || this.queue.length >= 200) return;
    this.queue.push({ tenantId, mediaId });
    if (!this.running) this.pump();
  }
  async pump() {
    this.running = true;
    while (this.queue.length) {
      const { tenantId, mediaId } = this.queue.shift();
      try {
        const m = this.db.prepare('SELECT storage_key FROM media WHERE id = ? AND tenant_id = ?').get(mediaId, tenantId);
        if (!m) continue;
        const src = this.storage.pathForKey(m.storage_key);
        const thumbKey = m.storage_key.replace(/\.[a-z0-9]+$/, '.thumb.jpg');
        const dest = this.storage.pathForKey(thumbKey);
        const r = await run(this.ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', '-i', src, '-vf', 'scale=480:-2', '-frames:v', '1', '-q:v', '5', dest], { timeoutMs: 20000 });
        if (r.code === 0 && fs.existsSync(dest)) this.db.prepare('UPDATE media SET thumb_key = ? WHERE id = ? AND tenant_id = ?').run(thumbKey, mediaId, tenantId);
        else fs.rmSync(dest, { force: true });
      } catch (e) { this.log?.warn('Thumbnail failed', { error: e.message }); }
    }
    this.running = false;
  }
}
