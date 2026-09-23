// Locates external tools (ffmpeg, Chrome/Chromium) WITHOUT installing or
// modifying anything. Paths are only shown to admins, never to ordinary users.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function onPath(names) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) {
      const p = path.join(dir, n);
      try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

export function findFfmpeg(configured) {
  if (configured) return fs.existsSync(configured) ? configured : null;
  return onPath(['ffmpeg']);
}

export function findChrome(configured) {
  if (configured) return fs.existsSync(configured) ? configured : null;
  const found = onPath(['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']);
  if (found) return found;
  // Playwright-managed browsers (read-only use).
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw && fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(pw, d, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

/** Run a command with a timeout; resolves { code, stdout, stderr, timedOut }. Never uses a shell. */
export function run(cmd, args, { timeoutMs = 15000, env } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false;
    let child;
    try { child = spawn(cmd, args, { env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: -1, stdout, stderr: String(e.message), timedOut }); return; }
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < 100000) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 100000) stderr += d; });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, stdout, stderr: String(e.message), timedOut }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export async function toolVersion(bin, args = ['--version']) {
  if (!bin) return null;
  const r = await run(bin, args, { timeoutMs: 8000 });
  return r.code === 0 ? (r.stdout || r.stderr).split('\n')[0].trim().slice(0, 120) : null;
}
