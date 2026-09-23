// Performance smoke test: API latency with a large project, and a lightweight frontend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, loggedIn } from './helpers.js';
import { APP_DIR } from '../src/config.js';

const p95 = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length * 0.95) - 1];

test('API stays fast with 500 scenes and 200 projects', async () => {
  const ctx = await startApp({ startWorker: false });
  const { client } = await loggedIn(ctx, 1);
  const pid = (await client.post('/api/projects', { title: 'Big project' })).data.id;
  const script = Array.from({ length: 500 }, (_, i) => `SCENE_ID: P${i}\nTITLE: Scene ${i}\nDESCRIPTION: Synthetic\nIMAGE_PROMPT: prompt ${i}\nVIDEO_PROMPT: v ${i}\nDURATION: 10`).join('\n---\n');
  const t0 = Date.now();
  const imp = await client.post(`/api/projects/${pid}/script/import`, { text: script, confirm: true });
  assert.equal(imp.data.imported, 500);
  const importMs = Date.now() - t0;
  for (let i = 0; i < 199; i++) await client.post('/api/projects', { title: `Filler ${i}` });

  const timings = { scenes: [], projects: [], workflow: [] };
  for (let i = 0; i < 20; i++) {
    let t = performance.now(); await client.get(`/api/projects/${pid}/scenes`); timings.scenes.push(performance.now() - t);
    t = performance.now(); await client.get('/api/projects?limit=24'); timings.projects.push(performance.now() - t);
    t = performance.now(); await client.get(`/api/projects/${pid}/workflow`); timings.workflow.push(performance.now() - t);
  }
  const report = { importMs, scenesP95: p95(timings.scenes), projectsP95: p95(timings.projects), workflowP95: p95(timings.workflow) };
  console.log('PERF', JSON.stringify(report));
  assert.ok(importMs < 3000, `import 500 scenes: ${importMs}ms`);
  assert.ok(report.scenesP95 < 250, `scene list p95 ${report.scenesP95}ms`);
  assert.ok(report.projectsP95 < 100, `project list p95 ${report.projectsP95}ms`);
  assert.ok(report.workflowP95 < 100, `workflow p95 ${report.workflowP95}ms`);

  // Queue a 500-job run: enqueue must not block the UI.
  const t1 = Date.now();
  await client.post(`/api/projects/${pid}/generation`, { provider: 'SIMULATED' });
  const enqueueMs = Date.now() - t1;
  assert.ok(enqueueMs < 2000, `enqueue 500 jobs: ${enqueueMs}ms`);
  await ctx.close();
});

test('frontend payload is lightweight (no framework, no heavy WebGL)', () => {
  let total = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size; } };
  walk(path.join(APP_DIR, 'public'));
  console.log('PERF frontend bytes', total);
  assert.ok(total < 200 * 1024, `public/ is ${total} bytes`);
  const js = fs.readdirSync(path.join(APP_DIR, 'public/js/views')).map((f) => fs.readFileSync(path.join(APP_DIR, 'public/js/views', f), 'utf8')).join('');
  assert.ok(!/innerHTML\s*=/.test(js), 'no innerHTML assignments in views');
  assert.ok(!/webgl|three\.js/i.test(js));
});
