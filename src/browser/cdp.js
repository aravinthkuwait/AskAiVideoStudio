// Minimal Chrome DevTools Protocol client + launcher (Node built-ins only:
// child_process + global WebSocket). Shared by the Flow Feasibility Lab and the
// future browser worker. Never uses a shell, never exposes the debugging port
// beyond 127.0.0.1, and always uses an explicit, private user-data-dir.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export class CdpError extends Error {}

export class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new CdpError(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new CdpError('Browser connection closed.'));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new CdpError(`Timeout waiting for ${method}.`)); }, timeoutMs);
      this.pending.set(id, { resolve: (r) => { clearTimeout(t); resolve(r); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Resolve with the first event matching method (+ optional predicate) within timeoutMs. */
  waitFor(method, { sessionId, predicate = () => true, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const off = () => { clearTimeout(t); this.listeners.delete(fn); };
      const fn = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId) && predicate(msg.params || {})) { off(); resolve(msg.params || {}); }
      };
      const t = setTimeout(() => { off(); reject(new CdpError(`Timeout waiting for ${method}.`)); }, timeoutMs);
      this.listeners.add(fn);
    });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/**
 * Launch Chromium with a dedicated profile and connect over CDP.
 * Returns { client, version, newPage(), close(), exited }.
 */
export async function launchBrowser({ executable, profileDir, headless = true, extraArgs = [], startTimeoutMs = 30000, env } = {}) {
  if (!executable) throw new CdpError('No browser executable.');
  if (!profileDir || !path.isAbsolute(profileDir)) throw new CdpError('Profile directory must be an absolute private path.');
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking',
    '--disable-component-update', '--password-store=basic', '--disable-features=Translate,MediaRouter',
    ...(headless ? ['--headless=new', '--disable-gpu'] : []),
    ...(isRoot ? ['--no-sandbox'] : []),
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], env: env || process.env });
  let stderr = '';
  proc.stderr.on('data', (d) => { if (stderr.length < 20000) stderr += d; });
  const exited = new Promise((r) => proc.once('exit', (code, signal) => r({ code, signal })));

  const t0 = Date.now();
  let wsPath = null;
  while (Date.now() - t0 < startTimeoutMs) {
    if (proc.exitCode !== null) throw new CdpError(`Browser exited during start-up (code ${proc.exitCode}).`);
    try {
      const [port, p] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && p) { wsPath = `ws://127.0.0.1:${port}${p}`; break; }
    } catch { /* not yet */ }
    await sleep(100);
  }
  if (!wsPath) { proc.kill('SIGKILL'); throw new CdpError('Browser did not open its control port in time.'); }

  const ws = new WebSocket(wsPath);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new CdpError('Could not connect to browser.')), { once: true }); });
  const client = new CdpClient(ws);
  const version = await client.send('Browser.getVersion');

  async function newPage() {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    return {
      sessionId,
      async navigate(url, { timeoutMs = 30000 } = {}) {
        const loaded = client.waitFor('Page.loadEventFired', { sessionId, timeoutMs });
        loaded.catch(() => {}); // always observed, even if navigate() fails first
        try {
          const r = await client.send('Page.navigate', { url }, sessionId, timeoutMs);
          if (r.errorText) throw new CdpError(`Navigation failed: ${r.errorText}`);
          await loaded;
        } catch (e) {
          await client.send('Page.stopLoading', {}, sessionId, 5000).catch(() => {});
          throw e;
        }
      },
      async evaluate(expression) {
        const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (r.exceptionDetails) throw new CdpError('Page script failed.');
        return r.result.value;
      },
    };
  }

  /** Graceful close (flushes cookies/profile to disk), then force-kill if needed. */
  async function close(timeoutMs = 10000) {
    try { await client.send('Browser.close', {}, undefined, 5000); } catch { /* fall through */ }
    client.close();
    const done = await Promise.race([exited, sleep(timeoutMs).then(() => null)]);
    if (!done) { proc.kill('SIGKILL'); await exited; return { graceful: false }; }
    return { graceful: true };
  }

  return { client, version, newPage, close, exited, stderr: () => stderr, pid: proc.pid };
}
