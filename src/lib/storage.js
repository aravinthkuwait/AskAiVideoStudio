// Private media storage. Every path is derived server-side from immutable ids
// and verified to stay inside the private root (path-traversal protection).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { isId, newId } from './ids.js';
import { isInside } from '../config.js';
import { AppError, tooLarge } from './errors.js';

export class Storage {
  constructor(privateRoot) {
    this.root = path.resolve(privateRoot);
    this.mediaRoot = path.join(this.root, 'media');
    this.tempRoot = path.join(this.root, 'temp');
  }

  /** Resolve a path strictly inside the private root. Throws on traversal. */
  resolve(...parts) {
    for (const p of parts) {
      if (typeof p !== 'string' || p.includes('\0') || p.includes('..') || path.isAbsolute(p)) {
        throw new AppError(400, 'BAD_PATH', 'Invalid storage path.');
      }
    }
    const full = path.resolve(this.root, ...parts);
    if (!isInside(this.root, full) || full === this.root) throw new AppError(400, 'BAD_PATH', 'Invalid storage path.');
    return full;
  }

  /** Storage key (relative) for a tenant/project-scoped media object. */
  mediaKey(tenantId, projectId, mediaId, ext) {
    if (!isId(tenantId) || !isId(mediaId) || (projectId && !isId(projectId))) throw new AppError(400, 'BAD_PATH', 'Invalid storage path.');
    if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new AppError(400, 'BAD_PATH', 'Invalid extension.');
    return path.posix.join('media', tenantId, projectId || 'library', `${mediaId}.${ext}`);
  }

  pathForKey(key) { return this.resolve(...key.split('/')); }

  /**
   * Stream a request body to a temp file with a hard size limit, returning
   * { tempPath, bytes, sha256, head } where head is the first 64 bytes for sniffing.
   */
  async receiveToTemp(readable, maxBytes) {
    fs.mkdirSync(this.tempRoot, { recursive: true, mode: 0o700 });
    const tempPath = path.join(this.tempRoot, `upload-${newId()}.part`);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    let head = Buffer.alloc(0);
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) return cb(tooLarge());
        if (head.length < 64) head = Buffer.concat([head, chunk.subarray(0, 64 - head.length)]);
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(readable, limiter, fs.createWriteStream(tempPath, { mode: 0o600 }));
    } catch (err) {
      fs.rmSync(tempPath, { force: true });
      throw err;
    }
    return { tempPath, bytes, sha256: hash.digest('hex'), head };
  }

  /** Move a temp file into its final key. Never overwrites an existing file. */
  commitTemp(tempPath, key) {
    const dest = this.pathForKey(key);
    if (!isInside(this.tempRoot, tempPath)) throw new AppError(400, 'BAD_PATH', 'Invalid temp path.');
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    if (fs.existsSync(dest)) throw new AppError(409, 'EXISTS', 'Storage object already exists.');
    fs.renameSync(tempPath, dest);
    return dest;
  }

  writeBuffer(key, buf) {
    const dest = this.pathForKey(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dest, buf, { mode: 0o600, flag: 'wx' });
    return dest;
  }

  /** Remove stale temp uploads older than maxAgeMs (scoped to our temp dir only). */
  cleanTemp(maxAgeMs = 6 * 3600 * 1000) {
    if (!fs.existsSync(this.tempRoot)) return 0;
    let n = 0;
    for (const name of fs.readdirSync(this.tempRoot)) {
      if (!/^upload-[0-9a-f-]{36}\.part$/.test(name)) continue;
      const p = path.join(this.tempRoot, name);
      if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { force: true }); n++; }
    }
    return n;
  }
}

/** Display-only filename sanitiser. Stored files NEVER use user filenames. */
export function safeDisplayName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  const cleaned = base.normalize('NFKC').replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 180);
}
