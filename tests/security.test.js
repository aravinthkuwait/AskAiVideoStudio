import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, loggedIn, createUser, Client, fakePng, FAKE_PASSWORD } from './helpers.js';

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.close(); });

test('API requires authentication', async () => {
  const c = new Client(ctx.url);
  for (const u of ['/api/projects', '/api/jobs', '/api/system/diagnostics', '/api/characters']) {
    assert.equal((await c.get(u)).status, 401, u);
  }
  assert.equal((await c.get('/api/health')).status, 200);
});

test('login: wrong password rejected with generic message; cookie is HttpOnly + SameSite', async () => {
  const u = await createUser(ctx.db, 50);
  const c = new Client(ctx.url);
  const bad = await c.post('/api/auth/login', { email: u.email, password: 'fake-wrong-pw-123' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error.message, 'Email or password is incorrect.');
  const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'fake-wrong-pw-123' });
  assert.equal(unknown.data.error.message, bad.data.error.message, 'no account enumeration');
  const ok = await c.post('/api/auth/login', { email: u.email, password: u.password });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.ok(!('password_hash' in ok.data.user));
});

test('login is rate limited per account', async () => {
  const u = await createUser(ctx.db, 51);
  const c = new Client(ctx.url);
  let last;
  for (let i = 0; i < 10; i++) last = await c.post('/api/auth/login', { email: u.email, password: 'fake-wrong-pw-xyz' });
  assert.equal(last.status, 429);
});

test('CSRF token and same-origin are required for state changes', async () => {
  const { client } = await loggedIn(ctx, 52);
  const saved = client.csrf;
  client.csrf = null;
  assert.equal((await client.post('/api/projects', { title: 'x' })).status, 403);
  client.csrf = 'forged-token';
  assert.equal((await client.post('/api/projects', { title: 'x' })).status, 403);
  client.csrf = saved;
  const cross = await client.req('POST', '/api/projects', { title: 'x' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal((await client.post('/api/projects', { title: 'ok' })).status, 200);
});

test('tenant isolation: another customer cannot read or modify anything', async () => {
  const a = (await loggedIn(ctx, 60)).client;
  const b = (await loggedIn(ctx, 61)).client;
  const p = (await a.post('/api/projects', { title: 'Tenant A private project' })).data;
  const scene = (await a.post(`/api/projects/${p.id}/scenes`, { title: 'A scene', image_prompt: 'x' })).data;
  const cand = (await a.upload(`/api/scenes/${scene.id}/candidates?source=UPLOAD`, fakePng())).data;
  const ch = (await a.post('/api/characters', { name: 'Secret Character' })).data;
  const run = (await a.post(`/api/projects/${p.id}/generation`, { provider: 'SIMULATED', force: true })).data;

  const denied = [
    ['GET', `/api/projects/${p.id}`], ['PATCH', `/api/projects/${p.id}`, { title: 'hijack' }], ['POST', `/api/projects/${p.id}/archive`],
    ['GET', `/api/projects/${p.id}/scenes`], ['GET', `/api/scenes/${scene.id}`], ['PATCH', `/api/scenes/${scene.id}`, { title: 'x' }],
    ['GET', `/api/media/${cand.media.id}`], ['POST', `/api/candidates/${cand.id}/approve`], ['GET', `/api/characters/${ch.id}`],
    ['GET', `/api/runs/${run.runId}`], ['POST', `/api/runs/${run.runId}/pause`], ['POST', `/api/jobs/${run.queued[0].jobId}/skip`],
    ['POST', `/api/projects/${p.id}/duplicate`], ['PUT', `/api/projects/${p.id}/scene-order`, { sceneIds: [scene.id] }],
  ];
  for (const [m, u, body] of denied) {
    const r = await b.req(m, u, body);
    assert.equal(r.status, 404, `${m} ${u} must be hidden from another tenant (got ${r.status})`);
  }
  const bList = (await b.get('/api/projects')).data;
  assert.ok(!bList.items.some((x) => x.id === p.id));
  const bJobs = (await b.get('/api/jobs')).data;
  assert.equal(bJobs.items.length, 0);
  // B uploading into A's scene must fail too
  assert.equal((await b.upload(`/api/scenes/${scene.id}/candidates?source=UPLOAD`, fakePng())).status, 404);
  assert.equal((await a.get(`/api/projects/${p.id}`)).data.project.title, 'Tenant A private project');
});

test('uploads: content sniffing, size limit, safe storage names, never executable', async () => {
  const { client } = await loggedIn(ctx, 70);
  const p = (await client.post('/api/projects', { title: 'Uploads' })).data;
  const s = (await client.post(`/api/projects/${p.id}/scenes`, { title: 'S' })).data;
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal((await client.upload(`/api/scenes/${s.id}/candidates`, html, { name: 'evil.png' })).status, 415);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  assert.equal((await client.upload(`/api/scenes/${s.id}/candidates`, svg, { type: 'image/svg+xml', name: 'x.svg' })).status, 415);
  assert.equal((await client.upload(`/api/scenes/${s.id}/candidates`, fakePng(), { name: 'mismatch.jpg' })).status, 415);
  assert.equal((await client.upload(`/api/scenes/${s.id}/candidates?source=HACK`, fakePng())).status, 400);
  const big = Buffer.concat([fakePng(), Buffer.alloc(ctx.config.maxUploadBytes + 10)]);
  assert.equal((await client.upload(`/api/scenes/${s.id}/candidates`, big)).status, 413);
  const ok = await client.upload(`/api/scenes/${s.id}/candidates`, fakePng(), { name: '../../../etc/passwd.png' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.media.originalFilename, 'passwd.png');
  const row = ctx.db.prepare('SELECT storage_key FROM media WHERE id = ?').get(ok.data.media.id);
  assert.match(row.storage_key, /^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
  const m = await client.get(ok.data.media.url);
  assert.equal(m.status, 200);
  assert.equal(m.headers.get('content-type'), 'image/png');
  assert.equal(m.headers.get('x-content-type-options'), 'nosniff');
  assert.match(m.headers.get('content-security-policy'), /sandbox/);
  // temp dir is empty after uploads (including rejected ones)
  assert.deepEqual(fs.readdirSync(path.join(ctx.config.privateRoot, 'temp')), []);
});

test('static files: path traversal blocked, security headers present', async () => {
  const c = new Client(ctx.url);
  for (const u of ['/../package.json', '/%2e%2e/package.json', '/..%2fsrc%2fconfig.js', '/js/../../.env']) {
    const r = await c.get(u);
    const text = r.data instanceof ArrayBuffer ? Buffer.from(r.data).toString() : JSON.stringify(r.data);
    assert.ok(r.status === 404 || (r.status === 200 && text.includes('<!doctype html>')), `${u} -> ${r.status}`);
    assert.ok(!text.includes('PRIVATE_STORAGE_ROOT') && !text.includes('"type": "module"'));
  }
  const r = await c.get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});

test('errors never expose stack traces, paths or SQL', async () => {
  const { client } = await loggedIn(ctx, 80);
  const bad = await client.req('POST', '/api/projects', '{not json', { raw: true, headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
  const v = await client.post('/api/projects', { title: '' });
  assert.equal(v.status, 422);
  const nf = await client.get('/api/projects/00000000-0000-4000-8000-000000000000');
  assert.equal(nf.status, 404);
  for (const r of [bad, v, nf]) {
    const s = JSON.stringify(r.data);
    assert.ok(!/\/(home|tmp|src)\/|at .*\.js:\d+|SQLITE|node:internal/.test(s), s);
  }
});

test('diagnostics are admin-only; members cannot see infrastructure', async () => {
  const member = (await loggedIn(ctx, 90, 'member')).client;
  assert.equal((await member.get('/api/system/diagnostics')).status, 403);
  assert.equal((await member.post('/api/flow-lab/run', {})).status, 403);
  const storage = (await member.get('/api/system/storage')).data;
  assert.equal(storage.temporaryBytes, undefined);
  const owner = (await loggedIn(ctx, 91, 'owner')).client;
  const d = (await owner.get('/api/system/diagnostics')).data;
  assert.equal(d.database.status, 'ok');
  assert.ok(!JSON.stringify(d).includes(ctx.config.privateRoot), 'no filesystem paths in diagnostics');
});

test('Google Flow provider is disabled and cannot be used to spend credits', async () => {
  const { client } = await loggedIn(ctx, 95);
  const p = (await client.post('/api/projects', { title: 'Flow' })).data;
  await client.post(`/api/projects/${p.id}/scenes`, { title: 'S', image_prompt: 'x' });
  const r = await client.post(`/api/projects/${p.id}/generation`, { provider: 'GOOGLE_FLOW', confirmCredits: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error.message, /not enabled/);
  const prov = (await client.get('/api/providers')).data.items.find((x) => x.id === 'GOOGLE_FLOW');
  assert.equal(prov.available, false);
});

test('no credentials or session tokens appear in logs or audit records', async () => {
  const u = await createUser(ctx.db, 99);
  const c = new Client(ctx.url);
  await c.post('/api/auth/login', { email: u.email, password: 'wrong-password-log-test' });
  assert.equal((await c.login(u.email, u.password)).status, 200);
  const token = c.cookie.split('=')[1];
  const logs = fs.readdirSync(path.join(ctx.config.privateRoot, 'logs')).map((f) => fs.readFileSync(path.join(ctx.config.privateRoot, 'logs', f), 'utf8')).join('\n');
  const audit = JSON.stringify(ctx.db.prepare('SELECT * FROM audit_log').all());
  for (const secret of [FAKE_PASSWORD, 'wrong-password-log-test', token, c.csrf]) {
    assert.ok(!logs.includes(secret), 'secret found in logs');
    assert.ok(!audit.includes(secret), 'secret found in audit log');
  }
  const sessionRow = ctx.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(u.userId);
  assert.notEqual(sessionRow.token_hash, token, 'raw session token is not stored');
});

test('logout invalidates the session server-side', async () => {
  const { client } = await loggedIn(ctx, 100);
  const cookie = client.cookie;
  await client.post('/api/auth/logout');
  const replay = new Client(ctx.url);
  replay.cookie = cookie;
  assert.equal((await replay.get('/api/projects')).status, 401);
});
