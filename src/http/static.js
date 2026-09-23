// Static file server for /public with path-traversal protection and caching.
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../config.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export function createStatic(root) {
  const base = path.resolve(root);
  return function serve(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return false; }
    if (rel.includes('\0')) return false;
    let file = path.resolve(base, '.' + rel);
    if (!isInside(base, file)) return false;
    const ext = path.extname(file);
    if (!ext) file = path.join(base, 'index.html'); // SPA route
    if (!TYPES[path.extname(file)]) return false;
    let st;
    try { st = fs.statSync(file); if (!st.isFile()) return false; } catch { return false; }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const isHtml = file.endsWith('.html');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', isHtml ? 'no-cache' : 'public, max-age=300, must-revalidate');
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
