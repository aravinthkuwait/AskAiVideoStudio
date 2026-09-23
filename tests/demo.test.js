// PHASE 1 DEMO — 3-scene synthetic project. No Google credits, no network.
// Covers: Master Script import, scene creation, reorder, image upload,
// candidates, approval protection, simulated jobs, pause, resume, failure,
// retry and restart recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, loggedIn, Client, fakePng, waitFor, DEMO_SCRIPT } from './helpers.js';

const states = (run) => run.jobs.map((j) => j.state);

test('Phase 1 demo: 3-scene project end-to-end', async (t) => {
  let ctx = await startApp({ env: { SIMULATED_STEP_MS: '40' } });
  const { client, user } = await loggedIn(ctx, 1);
  let projectId, sceneIds;

  await t.test('create project with defaults (16:9, 10s)', async () => {
    const r = await client.post('/api/projects', { title: 'Demo — The Fictional Harbour' });
    assert.equal(r.status, 200);
    assert.equal(r.data.aspect_ratio, '16:9');
    assert.equal(r.data.scene_duration_sec, 10);
    projectId = r.data.id;
  });

  await t.test('master script: preview validates; import only after confirmation', async () => {
    const prev = await client.post(`/api/projects/${projectId}/script/preview`, { text: DEMO_SCRIPT });
    assert.equal(prev.data.canImport, true);
    assert.equal(prev.data.scenes.length, 3);
    assert.equal((await client.get(`/api/projects/${projectId}/scenes`)).data.items.length, 0, 'preview writes nothing');
    assert.equal((await client.post(`/api/projects/${projectId}/script/import`, { text: DEMO_SCRIPT })).status, 400, 'confirmation required');
    const bad = await client.post(`/api/projects/${projectId}/script/import`, { text: 'SCENE_ID: X\nDURATION: nope', confirm: true });
    assert.equal(bad.data.imported, 0);
    const imp = await client.post(`/api/projects/${projectId}/script/import`, { text: DEMO_SCRIPT, confirm: true });
    assert.equal(imp.data.imported, 3);
    const list = (await client.get(`/api/projects/${projectId}/scenes`)).data.items;
    assert.deepEqual(list.map((s) => s.scene_code), ['S001', 'S002', 'S003']);
    assert.deepEqual(list.map((s) => s.image_source), ['FLOW', 'FLOW', 'FLOW'], 'Google Flow is the default image source');
    const s1 = (await client.get(`/api/scenes/${list[0].id}`)).data.scene;
    assert.equal(s1.dialogue, 'NOVA: We made it.\nNARRATOR: And so it began.');
    sceneIds = list.map((s) => s.id);
    const wf = (await client.get(`/api/projects/${projectId}`)).data.workflow;
    assert.equal(wf.steps[0].state, 'completed');
    assert.equal(wf.steps.find((s) => s.key === 'IMAGES').state, 'current');
  });

  await t.test('reorder scenes (must include every scene exactly once)', async () => {
    const r = await client.put(`/api/projects/${projectId}/scene-order`, { sceneIds: [sceneIds[2], sceneIds[0], sceneIds[1]] });
    assert.deepEqual(r.data.items.map((s) => s.scene_code), ['S003', 'S001', 'S002']);
    assert.equal((await client.put(`/api/projects/${projectId}/scene-order`, { sceneIds: [sceneIds[0]] })).status, 400);
    await client.put(`/api/projects/${projectId}/scene-order`, { sceneIds });
  });

  let cand1;
  await t.test('external (ChatGPT) image upload for scene 3 + approve', async () => {
    await client.patch(`/api/scenes/${sceneIds[2]}`, { image_source: 'EXTERNAL' });
    const map = await client.post(`/api/projects/${projectId}/image-mapping/preview`, { filenames: ['Scene_003.png', 'unknown.png'] });
    assert.equal(map.data.rows[0].sceneId, sceneIds[2]);
    assert.equal(map.data.rows[1].sceneId, null);
    const up = await client.upload(`/api/scenes/${sceneIds[2]}/candidates?source=EXTERNAL`, fakePng(), { name: 'Scene_003.png' });
    assert.equal(up.status, 200);
    assert.equal(up.data.source, 'EXTERNAL');
    assert.equal(up.data.media.originalFilename, 'Scene_003.png');
    cand1 = up.data;
    const ap = await client.post(`/api/candidates/${cand1.id}/approve`, {});
    assert.equal(ap.data.status, 'APPROVED');
  });

  await t.test('multiple candidates; approved image is protected', async () => {
    const up2 = await client.upload(`/api/scenes/${sceneIds[2]}/candidates?source=UPLOAD`, fakePng(80, 45), { name: 'alt.png' });
    const scene = (await client.get(`/api/scenes/${sceneIds[2]}`)).data;
    assert.equal(scene.scene.image_status, 'APPROVED', 'a new candidate does not change approval');
    assert.equal(scene.scene.approved_candidate_id, cand1.id);
    assert.equal(scene.candidates.length, 2);
    const blocked = await client.post(`/api/candidates/${up2.data.id}/approve`, {});
    assert.equal(blocked.status, 409, 'switching approval requires explicit confirmation');
    const rejectApproved = await client.post(`/api/candidates/${cand1.id}/reject`, {});
    assert.equal(rejectApproved.status, 409);
    const sw = await client.post(`/api/candidates/${up2.data.id}/approve`, { replaceApproved: true });
    assert.equal(sw.data.status, 'APPROVED');
    const after = (await client.get(`/api/scenes/${sceneIds[2]}`)).data.candidates;
    assert.equal(after.find((c) => c.id === cand1.id).status, 'CANDIDATE', 'previous approved image preserved as alternative');
    assert.equal(after.filter((c) => c.status === 'APPROVED').length, 1);
  });

  let runId;
  await t.test('simulated generation job for scenes 1–2, with pause and resume', async () => {
    const r = await client.post(`/api/projects/${projectId}/generation`, { provider: 'SIMULATED' });
    assert.equal(r.status, 200);
    assert.equal(r.data.queued.length, 2, 'approved scene 3 is not queued');
    runId = r.data.runId;
    // UI stays responsive while the job runs
    const t0 = Date.now();
    assert.equal((await client.get('/api/projects')).status, 200);
    assert.ok(Date.now() - t0 < 500);
    await waitFor(async () => (await client.get(`/api/runs/${runId}`)).data.jobs.some((j) => ['GENERATING', 'DOWNLOADING'].includes(j.state)));
    const paused = await client.post(`/api/runs/${runId}/pause`);
    assert.equal(paused.data.state, 'PAUSED');
    await new Promise((res) => setTimeout(res, 300));
    const still = (await client.get(`/api/runs/${runId}`)).data;
    assert.ok(still.jobs.every((j) => j.state === 'PAUSED'), `all jobs paused: ${states(still)}`);
    assert.ok(still.resumePoint, 'resume point offered');
    assert.equal(still.resumePoint.scenePosition, 1);
    await client.post(`/api/runs/${runId}/resume`);
    const done = await waitFor(async () => { const d = (await client.get(`/api/runs/${runId}`)).data; return d.jobs.every((j) => j.state === 'COMPLETED') && d; });
    assert.equal(done.state, 'COMPLETED');
    const list = (await client.get(`/api/projects/${projectId}/scenes`)).data.items;
    assert.equal(list[0].image_status, 'CANDIDATES');
    assert.equal(list[1].image_status, 'CANDIDATES');
    assert.equal(list[2].image_status, 'APPROVED');
  });

  await t.test('completed scenes are NOT regenerated automatically', async () => {
    const again = await client.post(`/api/projects/${projectId}/generation`, { provider: 'SIMULATED', sceneIds: [sceneIds[0]] });
    assert.equal(again.data.queued.length, 0);
    assert.match(again.data.skipped[0].reason, /not regenerated/);
  });

  await t.test('failure then retry', async () => {
    const pid = (await client.post('/api/projects', { title: 'Failure demo' })).data.id;
    await client.post(`/api/projects/${pid}/script/import`, { text: DEMO_SCRIPT, confirm: true });
    const r = await client.post(`/api/projects/${pid}/generation`, { provider: 'SIMULATED', simulate: { failTimes: 1 } });
    const failed = await waitFor(async () => { const d = (await client.get(`/api/runs/${r.data.runId}`)).data; return d.jobs.every((j) => j.state === 'FAILED') && d; });
    assert.match(failed.jobs[0].errorSummary, /Simulated generation failure/);
    const scenes = (await client.get(`/api/projects/${pid}/scenes`)).data.items;
    assert.equal(scenes[0].image_status, 'FAILED');
    assert.equal((await client.get(`/api/projects/${pid}`)).data.workflow.steps.find((s) => s.key === 'IMAGES').state, 'failed');
    await client.post(`/api/scenes/${scenes[0].id}/retry`);
    for (const j of failed.jobs.slice(1)) await client.post(`/api/jobs/${j.id}/retry`);
    const ok = await waitFor(async () => { const d = (await client.get(`/api/runs/${r.data.runId}`)).data; return d.jobs.every((j) => j.state === 'COMPLETED') && d; });
    assert.ok(ok.jobs.every((j) => j.retryCount === 1));
    assert.equal((await client.post(`/api/jobs/${ok.jobs[0].id}/retry`)).status, 409, 'completed job cannot be re-run');
  });

  await t.test('restart recovery: interrupted job resumes, completed work is kept', async () => {
    const pid = (await client.post('/api/projects', { title: 'Recovery demo' })).data.id;
    await client.post(`/api/projects/${pid}/script/import`, { text: DEMO_SCRIPT, confirm: true });
    const r = await client.post(`/api/projects/${pid}/generation`, { provider: 'SIMULATED' });
    const rid = r.data.runId;
    // wait until scene 1 completed and scene 2 is in progress, then "crash"
    await waitFor(async () => { const d = (await client.get(`/api/runs/${rid}`)).data; return d.jobs[0].state === 'COMPLETED' && ['PREPARING', 'GENERATING', 'DOWNLOADING'].includes(d.jobs[1].state); }, { interval: 5 });
    const completedCandidate = ctx.db.prepare('SELECT id FROM image_candidates WHERE job_id = ?').get(r.data.queued[0].jobId).id;
    ctx.app.worker.stopping = true; clearInterval(ctx.app.worker.timer); // simulate hard crash: no graceful handling
    ctx.app.server.close(); ctx.app.server.closeAllConnections?.();
    ctx.db.close();

    // restart on the SAME private runtime
    const base = ctx.base;
    ctx = await startApp({ base, env: { SIMULATED_STEP_MS: '40' }, startWorker: false });
    ctx.app.worker.recover();
    const c2 = new Client(ctx.url);
    await c2.login(user.email, user.password);
    const after = (await c2.get(`/api/runs/${rid}`)).data;
    assert.equal(after.jobs[0].state, 'COMPLETED');
    assert.equal(after.jobs[1].state, 'INTERRUPTED');
    assert.equal(after.jobs[2].state, 'QUEUED');
    assert.equal(after.resumePoint.scenePosition, 2, 'RESUME FROM SCENE 2');
    await c2.post(`/api/runs/${rid}/resume`);
    ctx.app.worker.start();
    const done = await waitFor(async () => { const d = (await c2.get(`/api/runs/${rid}`)).data; return d.jobs.every((j) => j.state === 'COMPLETED') && d; });
    assert.equal(done.state, 'COMPLETED');
    const cands = ctx.db.prepare('SELECT job_id FROM image_candidates WHERE job_id IN (?, ?, ?)').all(...r.data.queued.map((q) => q.jobId));
    assert.equal(cands.length, 3, 'exactly one candidate per job (no duplicates)');
    assert.equal(ctx.db.prepare('SELECT id FROM image_candidates WHERE job_id = ?').get(r.data.queued[0].jobId).id, completedCandidate, 'scene 1 was not regenerated');
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE run_id = ?`).get(rid).n, 3);
  });

  await t.test('project rename / duplicate / archive (soft)', async () => {
    const c = new Client(ctx.url);
    await c.login(user.email, user.password);
    const ren = await c.patch(`/api/projects/${projectId}`, { title: 'Demo — renamed' });
    assert.equal(ren.data.title, 'Demo — renamed');
    const dup = (await c.post(`/api/projects/${projectId}/duplicate`)).data;
    const dupScenes = (await c.get(`/api/projects/${dup.id}/scenes`)).data.items;
    assert.equal(dupScenes.length, 3);
    assert.ok(dupScenes.every((s) => s.image_status === 'PENDING' && s.candidate_count === 0));
    await c.post(`/api/projects/${projectId}/archive`);
    assert.ok(!(await c.get('/api/projects')).data.items.some((p) => p.id === projectId));
    assert.ok((await c.get('/api/projects?status=ARCHIVED')).data.items.some((p) => p.id === projectId));
    assert.equal((await c.get(`/api/projects/${projectId}/scenes`)).data.items.length, 3, 'archive deletes nothing');
  });

  await t.test('character + asset libraries; asset image as scene candidate', async () => {
    const c = new Client(ctx.url);
    await c.login(user.email, user.password);
    const ch = (await c.post('/api/characters', { name: 'Explorer Nova', role: 'Lead', appearance: 'Fictional explorer, red scarf' })).data;
    await c.post(`/api/characters/${ch.id}/projects`, { projectId, linked: true });
    const withImg = (await c.upload(`/api/characters/${ch.id}/images`, fakePng(), { name: 'nova-ref.png' })).data;
    assert.equal(withImg.images.length, 1);
    assert.equal(withImg.projects[0].id, projectId);
    const as = (await c.post('/api/assets', { name: 'Old lighthouse', category: 'LOCATION' })).data;
    await c.upload(`/api/assets/${as.id}/images`, fakePng(), { name: 'lighthouse.png' });
    assert.equal((await c.post('/api/assets', { name: 'x', category: 'SPACESHIP' })).status, 422);
    const cand = await c.post(`/api/scenes/${sceneIds[0]}/candidates/from-asset`, { assetId: as.id });
    assert.equal(cand.data.source, 'ASSET');
    assert.equal((await c.get(`/api/projects/${projectId}/workflow`)).data.steps[1].state, 'completed', 'CHARACTERS step completed');
  });

  await ctx.close();
});
