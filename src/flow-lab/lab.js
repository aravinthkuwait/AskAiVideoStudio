// FLOW FEASIBILITY LAB — isolated from the production pipeline.
// SAFE checks only: they never sign in, never open Google Flow projects, never
// submit prompts and never consume credits. The optional reachability check
// makes a single unauthenticated HTTPS request and runs only when explicitly requested.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findChrome, run, toolVersion } from '../lib/tools.js';
import { newId, nowIso } from '../lib/ids.js';

export const FLOW_URL = 'https://labs.google/fx/tools/flow';

/** Status vocabulary shared with docs/FLOW_FEASIBILITY.md */
export const S = { VERIFIED: 'VERIFIED', NOT_VERIFIED: 'NOT VERIFIED', BLOCKED: 'BLOCKED', MANUAL: 'REQUIRES MANUAL TEST' };

export async function runSafeChecks(config, { checkReachability = false } = {}) {
  const items = [];
  const add = (key, label, status, detail) => items.push({ key, label, status, detail });
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  const chrome = findChrome(config.chromePath);
  add('browser_binary', 'Chromium/Chrome available', chrome ? S.VERIFIED : S.BLOCKED,
    chrome ? `Found (${(await toolVersion(chrome)) || 'version unknown'}).` : 'No Chrome/Chromium found. Set CHROME_PATH or install a browser for this application only.');

  const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  add('headed_mode', 'Headed (visible) browser for interactive login', hasDisplay ? S.MANUAL : S.BLOCKED,
    hasDisplay ? 'A display is available; headed login must be tested manually.'
      : 'No display server. Interactive Google login needs a visible browser (e.g. a remote desktop/VNC session or a local machine) — REQUIRES MANUAL SETUP.');

  if (chrome) {
    const profileDir = path.join(config.privateRoot, 'browser-profiles', `lab-ephemeral-${newId()}`);
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profileDir}`, '--dump-dom', 'about:blank'];
    if (isRoot) args.unshift('--no-sandbox');
    const r = await run(chrome, args, { timeoutMs: 30000 });
    const ok = r.code === 0 && /<html/i.test(r.stdout);
    add('headless_launch', 'Headless launch (about:blank, isolated temp profile)', ok ? S.VERIFIED : S.BLOCKED,
      ok ? 'Headless browser launched and rendered a blank page.' : `Launch failed${r.timedOut ? ' (timeout)' : ''}.`);
    add('profile_isolation', 'Isolated per-account profile directory', ok ? S.VERIFIED : S.NOT_VERIFIED,
      'Profiles live under PRIVATE_STORAGE_ROOT/browser-profiles/ (never in Git). The lab profile is temporary and deleted after the check.');
    fs.rmSync(profileDir, { recursive: true, force: true });
    if (isRoot) add('sandbox', 'Chromium sandbox', S.NOT_VERIFIED, 'Running as root requires --no-sandbox. Recommended: run the browser worker as a dedicated non-root user.');
  }

  if (checkReachability) {
    try {
      const res = await fetch(FLOW_URL, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
      add('network_reachability', 'Google Flow host reachable (unauthenticated, no login)', res.status < 500 ? S.VERIFIED : S.NOT_VERIFIED, `HTTP status ${res.status}.`);
    } catch (e) {
      add('network_reachability', 'Google Flow host reachable (unauthenticated, no login)', S.BLOCKED, `Request failed: ${String(e.cause?.code || e.name)}.`);
    }
  } else {
    add('network_reachability', 'Google Flow host reachable', S.NOT_VERIFIED, 'Not run. Optional; run with explicit consent.');
  }

  for (const [key, label] of [
    ['interactive_login', 'Interactive Google login (manual, no stored password)'],
    ['auth_persistence', 'Authentication persistence across restarts'],
    ['flow_access', 'Google Flow access with the signed-in account'],
    ['image_workflow', 'Image generation workflow'],
    ['image_to_video', 'Image-to-video workflow'],
    ['download', 'Result download'],
    ['session_persistence', 'Session persistence over days'],
    ['timeouts', 'Timeout behaviour'],
    ['errors', 'Error behaviour (quota, policy, CAPTCHA/MFA pause)'],
    ['selector_stability', 'UI selector stability'],
  ]) add(key, label, S.MANUAL, key === 'image_workflow' || key === 'image_to_video' ? 'May consume Google credits — requires your explicit approval before testing.' : 'Requires a signed-in manual session.');

  return {
    id: newId(),
    ranAt: nowIso(),
    environment: { platform: os.platform(), arch: os.arch(), node: process.version, runningAsRoot: isRoot, display: hasDisplay },
    creditsConsumed: false,
    productionAutomationEnabled: false,
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
