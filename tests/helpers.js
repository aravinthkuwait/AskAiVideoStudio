// Test harness. Uses a throw-away private root in the OS temp dir and FAKE
// credentials only. No production secrets are ever needed to run tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createTenantWithOwner } from '../src/services/users.js';
import { gradientPng } from '../src/lib/png.js';

export const FAKE_PASSWORD = 'correct-horse-battery-staple-test';

export function testEnv(base, overrides = {}) {
  return {
    NODE_ENV: 'test', PRIVATE_STORAGE_ROOT: path.join(base, 'private'), APP_SECRET: 'fake-test-secret-value-that-is-long-enough-0000',
    LOG_STDOUT: 'false', LOG_LEVEL: 'debug', SIMULATED_STEP_MS: '15', WORKER_POLL_MS: '20', COOKIE_SECURE: 'false', LOGIN_IP_LIMIT: '10000', ...overrides,
  };
}

export async function startApp({ base, env = {}, startWorker = true } = {}) {
  base ??= fs.mkdtempSync(path.join(os.tmpdir(), 'aavs-test-'));
  const config = loadConfig(testEnv(base, env), { loadDotEnv: false });
  const app = createApp(config);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  if (startWorker) app.worker.start();
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, config, base, url, db: app.db, close: () => app.close() };
}

export async function createUser(db, n = 1, role = 'owner') {
  const email = `tester${n}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const ids = await createTenantWithOwner(db, { email, displayName: `Test User ${n}`, tenantName: `Fake Studio ${n}`, password: FAKE_PASSWORD, role });
  return { email, password: FAKE_PASSWORD, ...ids };
}

/** Minimal cookie-aware client with CSRF handling. */
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = null; }
  async req(method, url, body, { raw = false, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    let payload;
    if (body !== undefined) {
      if (raw) payload = body; else { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    } else if (method !== 'GET') { h['Content-Type'] = 'application/json'; payload = '{}'; }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
  put(u, b) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
  upload(u, buf, { type = 'image/png', name = 'Scene_001.png' } = {}) {
    return this.req('POST', u, buf, { raw: true, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) } });
  }
  async login(email, password) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status === 200) this.csrf = r.data.csrfToken;
    return r;
  }
}

export async function loggedIn(ctx, n = 1, role = 'owner') {
  const u = await createUser(ctx.db, n, role);
  const c = new Client(ctx.url);
  const r = await c.login(u.email, u.password);
  if (r.status !== 200) throw new Error(`login failed ${r.status}`);
  return { client: c, user: u };
}

export const fakePng = (w = 64, h = 36) => gradientPng(w, h, [10, 20, 30], [200, 100, 50]);

export async function waitFor(fn, { timeout = 8000, interval = 20 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const DEMO_SCRIPT = `SCENE_ID: S001
TITLE: Dawn at the fictional harbour
DESCRIPTION: A fictional explorer arrives.
CHARACTERS: Explorer Nova
IMAGE_PROMPT: Wide cinematic shot of a misty harbour at dawn
VIDEO_PROMPT: Slow dolly-in
DIALOGUE: NOVA: We made it.
NARRATOR: And so it began.
DURATION: 10
---
SCENE_ID: S002
TITLE: The map
IMAGE_PROMPT: Close-up of an old map on a wooden table
VIDEO_PROMPT: Gentle push-in on the map
MOOD: mysterious
DURATION: 8s
---
SCENE_ID: S003
TITLE: The lighthouse
IMAGE_PROMPT: A lighthouse on a cliff under a stormy sky
VIDEO_PROMPT: Drone orbit around the lighthouse
DURATION: 12`;
