// FLOW FEASIBILITY LAB — Stage A. Isolated from the production pipeline.
// Every check below produces real evidence on THIS machine. The checks never
// sign in, never type into Google pages, never submit prompts and never
// consume credits. The only request to Google (unauthenticated page load of
// Flow) runs solely when explicitly requested (checkFlowNavigation).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { findChrome, toolVersion } from '../lib/tools.js';
import { newId, nowIso } from '../lib/ids.js';
import { launchBrowser } from '../browser/cdp.js';

export const FLOW_URL = 'https://labs.google/fx/tools/flow';
export const S = { VERIFIED: 'VERIFIED', NOT_VERIFIED: 'NOT VERIFIED', BLOCKED: 'BLOCKED', MANUAL: 'REQUIRES MANUAL TEST' };

/** Local-only test server used to prove navigation, cookies, downloads and timeouts. */
function startTestServer() {
  const hanging = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/set') {
      res.writeHead(200, { 'Set-Cookie': 'aavs_lab=persist-ok; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax', 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>set</title><p>cookie set</p>');
    }
    if (url.pathname === '/check') {
      const has = /(?:^|;\s*)aavs_lab=persist-ok/.test(req.headers.cookie || '');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<!doctype html><title>check</title><p id="r">${has ? 'PERSISTED' : 'MISSING'}</p>`);
    }
    if (url.pathname === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>AAVS lab page</title><main><h1 id="h">lab-ok</h1></main>');
    }
    if (url.pathname === '/download') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="lab-download.bin"', 'Content-Length': 4096 });
      return res.end(Buffer.alloc(4096, 7));
    }
    if (url.pathname === '/hang') { hanging.add(res); return undefined; } // never answers
    res.writeHead(404); return res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const r of hanging) r.destroy(); server.closeAllConnections?.(); server.close(); },
  })));
}

const modeOf = (p) => (fs.statSync(p).mode & 0o777).toString(8);

export async function runSafeChecks(config, opts = {}) {
  const ctx = { profileDir: null, downloadDir: null };
  try { return await runChecks(config, opts, ctx); } finally {
    // Always remove the temporary lab profile and downloads, even on failure.
    for (const d of [ctx.profileDir, ctx.downloadDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  }
}

async function runChecks(config, { checkFlowNavigation = false, headed = null } = {}, ctx) {
  const items = [];
  const add = (key, label, status, detail) => items.push({ key, label, status, detail });
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const isRoot = uid === 0;
  const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const useHeaded = headed ?? hasDisplay;
  const labRoot = path.join(config.privateRoot, 'browser-profiles', '_lab');
  const profileDir = ctx.profileDir = path.join(labRoot, newId());
  const downloadDir = ctx.downloadDir = path.join(config.privateRoot, 'flow-lab', `downloads-${newId()}`);
  let server = null;

  const chrome = findChrome(config.chromePath);
  add('browser_binary', 'Chrome/Chromium executable', chrome ? S.VERIFIED : S.BLOCKED,
    chrome ? `Found: ${(await toolVersion(chrome)) || 'version unknown'}.` : 'No Chrome/Chromium found. Set CHROME_PATH or install a browser for this application.');

  add('non_root', 'Non-root execution', isRoot ? S.BLOCKED : S.VERIFIED,
    isRoot ? 'The lab ran as root, so Chromium needed --no-sandbox. Run the browser worker as a dedicated non-root user (requires approval to create).'
      : `Ran as a non-root user; Chromium sandbox left enabled.`);

  add('display', 'Display available for a visible (headed) browser', hasDisplay ? S.VERIFIED : S.BLOCKED,
    hasDisplay ? 'A display is available to this process.' : 'No DISPLAY/WAYLAND_DISPLAY. Manual Google login needs a visible browser — see RISK APPROVAL in docs/FLOW_FEASIBILITY.md.');

  try {
    fs.mkdirSync(labRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(downloadDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const probe = path.join(downloadDir, '.write-test');
    fs.writeFileSync(probe, 'x', { mode: 0o600 }); fs.rmSync(probe);
    const ok = modeOf(profileDir) === '700' && modeOf(downloadDir) === '700';
    add('storage_permissions', 'Private profile + download directories (0700, writable)', ok ? S.VERIFIED : S.NOT_VERIFIED,
      `Profile dir mode ${modeOf(profileDir)}, download dir mode ${modeOf(downloadDir)}, under PRIVATE_STORAGE_ROOT.`);
  } catch (e) {
    add('storage_permissions', 'Private profile + download directories (0700, writable)', S.BLOCKED, `Could not create private directories (${e.code || 'error'}).`);
  }

  if (chrome) {
    server = await startTestServer();
    let b = null;
    try {
      // 1) Startup + navigation
      b = await launchBrowser({ executable: chrome, profileDir, headless: !useHeaded });
      add('browser_startup', `Browser start-up (${useHeaded ? 'headed' : 'headless'}, isolated profile)`, S.VERIFIED, `Started and connected: ${b.version.product}.`);
      const page = await b.newPage();
      await page.navigate(`${server.base}/page`, { timeoutMs: 15000 });
      const h = await page.evaluate('document.getElementById("h")?.textContent');
      add('page_navigation', 'Page navigation + DOM read (local test page)', h === 'lab-ok' ? S.VERIFIED : S.NOT_VERIFIED, h === 'lab-ok' ? 'Loaded page and read an element by id.' : 'Expected element not found.');

      // 2) Download into the private directory
      await b.client.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true });
      const done = b.client.waitFor('Browser.downloadProgress', { predicate: (p) => p.state === 'completed' || p.state === 'canceled', timeoutMs: 15000 });
      await page.evaluate(`(() => { const a = document.createElement('a'); a.href = '${server.base}/download'; document.body.append(a); a.click(); return true; })()`);
      const prog = await done;
      const files = fs.readdirSync(downloadDir).filter((f) => !f.startsWith('.'));
      const f = files[0] && path.join(downloadDir, files[0]);
      const size = f ? fs.statSync(f).size : 0;
      const inside = f && path.resolve(f).startsWith(path.resolve(downloadDir) + path.sep) && !fs.lstatSync(f).isSymbolicLink();
      add('download', 'Download to private directory (verified non-zero, no symlink)', prog.state === 'completed' && size === 4096 && inside ? S.VERIFIED : S.NOT_VERIFIED,
        prog.state === 'completed' ? `Downloaded ${size} bytes inside the private download directory.` : 'Download did not complete.');

      // 3) Timeout handling
      const t0 = Date.now();
      let timedOut = false;
      try { await page.navigate(`${server.base}/hang`, { timeoutMs: 2000 }); } catch { timedOut = true; }
      const elapsed = Date.now() - t0;
      await page.navigate(`${server.base}/page`, { timeoutMs: 10000 });
      const alive = (await page.evaluate('document.title')) === 'AAVS lab page';
      add('timeouts', 'Timeout handling (hung page aborted, browser still usable)', timedOut && alive && elapsed < 6000 ? S.VERIFIED : S.NOT_VERIFIED,
        `Hung navigation aborted after ${elapsed} ms; browser responsive afterwards: ${alive ? 'yes' : 'no'}.`);

      // 4) Persistent profile across a clean browser restart
      await page.navigate(`${server.base}/set`, { timeoutMs: 10000 });
      const c1 = await b.close();
      b = await launchBrowser({ executable: chrome, profileDir, headless: !useHeaded });
      const p2 = await b.newPage();
      await p2.navigate(`${server.base}/check`, { timeoutMs: 10000 });
      const r = await p2.evaluate('document.getElementById("r")?.textContent');
      add('browser_restart', 'Clean browser close + restart', c1.graceful ? S.VERIFIED : S.NOT_VERIFIED, c1.graceful ? 'Browser closed gracefully and restarted with the same profile.' : 'Browser had to be force-killed.');
      add('profile_persistence', 'Persistent profile (cookie survives restart)', r === 'PERSISTED' ? S.VERIFIED : S.NOT_VERIFIED,
        r === 'PERSISTED' ? 'A test cookie written before restart was present after restart — the session-persistence ARCHITECTURE works. Google’s own session lifetime still requires a manual test.' : 'Test cookie was not persisted.');

      // 5) Optional: unauthenticated Flow page load (explicit consent only)
      if (checkFlowNavigation) {
        try {
          await p2.navigate(FLOW_URL, { timeoutMs: 30000 });
          const host = await p2.evaluate('location.host');
          const signIn = /accounts\.google\./.test(host) || (await p2.evaluate('/sign in/i.test(document.body?.innerText || "")'));
          add('flow_navigation', 'Google Flow page loads from this machine (not signed in)', S.VERIFIED,
            `Loaded; final host ${host}. ${signIn ? 'Sign-in is required (expected).' : 'No sign-in prompt detected.'} No input was typed and nothing was captured.`);
        } catch (e) {
          add('flow_navigation', 'Google Flow page loads from this machine (not signed in)', S.BLOCKED, `Could not load the Flow page: ${String(e.message).slice(0, 120)}`);
        }
      } else {
        add('flow_navigation', 'Google Flow page loads from this machine (not signed in)', S.NOT_VERIFIED, 'Not run. Optional; requires explicit consent (one unauthenticated page load, no login).');
      }
    } catch (e) {
      add('browser_startup', 'Browser start-up', S.BLOCKED, `Browser automation failed: ${String(e.message).slice(0, 160)}`);
    } finally {
      if (b) await b.close().catch(() => {});
      server?.close();
    }
  }

  for (const [key, label, note] of [
    ['interactive_login', 'Manual Google login in the dedicated profile (no stored password)', 'Needs a visible browser and you at the keyboard.'],
    ['google_session_persistence', 'Google session persists across browser/worker restart', 'Test after manual login.'],
    ['flow_access', 'Google Flow usable with the signed-in account', 'Test after manual login.'],
    ['image_workflow', 'Image generation workflow', 'CONSUMES CREDITS — explicit approval required before testing.'],
    ['image_to_video', 'Image-to-video workflow', 'CONSUMES CREDITS — explicit approval required before testing.'],
    ['flow_download', 'Flow result download', 'Test with the first approved real generation.'],
    ['selector_stability', 'Flow UI selector stability', 'Selectors must be recorded from the real signed-in UI.'],
    ['error_behaviour', 'Error behaviour (quota/credits, policy, CAPTCHA/MFA pause)', 'Observed during manual/approved tests only.'],
  ]) add(key, label, S.MANUAL, note);

  const blocking = items.filter((i) => ['browser_binary', 'browser_startup', 'non_root', 'display', 'profile_persistence', 'download', 'storage_permissions'].includes(i.key) && i.status !== S.VERIFIED);
  return {
    id: newId(),
    ranAt: nowIso(),
    environment: { platform: os.platform(), arch: os.arch(), node: process.version, runningAsRoot: isRoot, display: hasDisplay, mode: useHeaded ? 'headed' : 'headless' },
    creditsConsumed: false,
    productionAutomationEnabled: false,
    stageA: blocking.length === 0 ? 'READY FOR MANUAL LOGIN' : 'NOT PASSED',
    blockingItems: blocking.map((i) => i.key),
    items,
  };
}

export function saveReport(config, report) {
  const dir = path.join(config.privateRoot, 'flow-lab');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'latest-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}

export function loadReport(config) {
  try { return JSON.parse(fs.readFileSync(path.join(config.privateRoot, 'flow-lab', 'latest-report.json'), 'utf8')); } catch { return null; }
}
