import { h, mount, btn, badge, fmtDate, img, toast, confirmDialog, lightbox, pad, select } from '../dom.js';
import { gripIcon } from '../icons.js';
import { api } from '../api.js';
import { navigate, setTitle } from '../app.js';
import { openProjectDialog, workflowIndicator, poll } from './common.js';
import { openScriptImporter } from './importer.js';
import { openImageImport } from './imageImport.js';

const ACTIVE = ['QUEUED', 'PREPARING', 'GENERATING', 'DOWNLOADING'];

export async function render(main, { params: [projectId] }) {
  let project, workflow, scenes = [], runs = [], tab = 'scenes';
  const head = h('div');
  const wfBox = h('div');
  const tabsBox = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');

  async function loadAll() {
    const [p, s, g] = await Promise.all([api.get(`/api/projects/${projectId}`), api.get(`/api/projects/${projectId}/scenes`), api.get(`/api/projects/${projectId}/generation`)]);
    project = p.project; workflow = p.workflow; scenes = s.items; runs = g.runs;
    setTitle(project.title);
    paint();
  }
  async function refreshLight() {
    const [s, g, w] = await Promise.all([api.get(`/api/projects/${projectId}/scenes`), api.get(`/api/projects/${projectId}/generation`), api.get(`/api/projects/${projectId}/workflow`)]);
    scenes = s.items; runs = g.runs; workflow = w;
    mount(wfBox, workflowIndicator(workflow));
    paintBody();
  }
  const hasActiveWork = () => scenes.some((s) => ACTIVE.includes(s.job_state)) || runs.some((r) => r.state === 'ACTIVE' && r.jobs.some((j) => ACTIVE.includes(j.state)));
  const stopPoll = poll(async () => { if (hasActiveWork()) await refreshLight(); }, 1200);

  function paint() {
    mount(head, h('div', { class: 'page-head' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'crumbs' }, h('a', { href: '/projects' }, 'Projects'), ' / '),
        h('h1', null, project.title),
        h('p', null, h('span', { class: 'chip' }, project.aspect_ratio), ' ', h('span', { class: 'chip' }, `${project.scene_duration_sec}s default`), ' ',
          project.status === 'ARCHIVED' ? badge('ARCHIVED', 'archived') : null, ' ', h('span', { class: 'faint' }, `Updated ${fmtDate(project.updated_at)}`))),
      h('div', { class: 'row' },
        btn('Import script', () => openScriptImporter(project, loadAll), { icon: 'import', kind: 'primary' }),
        btn('Import images', () => openImageImport(project, scenes, loadAll), { icon: 'upload' }),
        btn('', () => openProjectDialog(project, loadAll), { icon: 'edit', title: 'Rename / settings', size: 'icon-btn' }),
        btn('', async () => { const c = await api.post(`/api/projects/${projectId}/duplicate`); toast('Project duplicated.', 'ok'); navigate(`/projects/${c.id}`); }, { icon: 'copy', title: 'Duplicate project', size: 'icon-btn' }),
        project.status === 'ACTIVE'
          ? btn('', async () => { if (await confirmDialog('Archive project?', 'Nothing is deleted. You can restore it from Projects → Archived.', { confirmLabel: 'Archive' })) { await api.post(`/api/projects/${projectId}/archive`); loadAll(); } }, { icon: 'archive', title: 'Archive project', size: 'icon-btn' })
          : btn('Restore', async () => { await api.post(`/api/projects/${projectId}/unarchive`); loadAll(); }))));
    if (project.description) head.append(h('p', { class: 'muted prewrap', style: { marginTop: '-10px' } }, project.description));
    mount(wfBox, workflowIndicator(workflow));
    paintTabs();
    paintBody();
  }

  function paintTabs() {
    mount(tabsBox, ...[['scenes', `Scenes (${scenes.length})`], ['generation', 'Generation']].map(([k, l]) =>
      h('button', { class: `tab ${tab === k ? 'active' : ''}`, role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; paintTabs(); paintBody(); } }, l)));
  }

  function paintBody() {
    paintTabs();
    if (tab === 'scenes') mount(body, sceneManager()); else mount(body, generationPanel());
  }

  // ---------------- Scene manager ----------------
  function sceneManager() {
    if (!scenes.length) {
      return h('div', { class: 'card empty' }, h('h3', null, 'No scenes yet'),
        h('p', null, 'Import a Master Script (text or JSON) or add scenes manually.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          btn('Import Master Script', () => openScriptImporter(project, loadAll), { kind: 'primary', icon: 'import' }),
          btn('Add blank scene', addScene, { icon: 'plus' })));
    }
    const list = h('div', { class: 'scenes', role: 'list' });
    scenes.forEach((s, i) => list.append(sceneCard(s, i)));
    enableDrag(list);
    return h('div', null, list, h('div', { class: 'row', style: { marginTop: '12px' } }, btn('Add scene', addScene, { icon: 'plus', kind: 'ghost' })));
  }

  async function addScene() {
    const s = await api.post(`/api/projects/${projectId}/scenes`, { title: `Scene ${scenes.length + 1}` });
    navigate(`/scenes/${s.id}`);
  }

  function sceneCard(s, i) {
    const mediaId = s.approved_media_id || s.latest_media_id;
    const failed = ['FAILED', 'INTERRUPTED'].includes(s.job_state);
    const running = ACTIVE.includes(s.job_state);
    const acts = h('div', { class: 'acts' },
      btn('Edit', () => navigate(`/scenes/${s.id}`), { size: 'sm', icon: 'edit' }),
      mediaId ? btn('', () => lightbox(mediaId, `Scene ${pad(s.position)} — ${s.title}`), { size: 'sm', icon: 'eye', title: 'Preview' }) : null,
      s.latest_candidate_id && s.latest_candidate_status !== 'APPROVED'
        ? btn('Approve', () => approve(s), { size: 'sm', icon: 'check', title: 'Approve the latest image' }) : null,
      s.latest_candidate_id
        ? btn('', () => reject(s), { size: 'sm', icon: 'x', title: 'Reject the latest image' }) : null,
      failed ? btn('Retry', async () => { await api.post(`/api/scenes/${s.id}/retry`); toast('Queued for retry.', 'ok'); refreshLight(); }, { size: 'sm', icon: 'retry' }) : null,
      btn(s.image_status === 'SKIPPED' ? 'Unskip' : '', async () => { await api.post(`/api/scenes/${s.id}/skip`, { skipped: s.image_status !== 'SKIPPED' }); refreshLight(); }, { size: 'sm', icon: 'skip', title: s.image_status === 'SKIPPED' ? 'Unskip scene' : 'Skip scene' }),
      btn('', async () => { await api.post(`/api/scenes/${s.id}/duplicate`); toast('Scene duplicated.', 'ok'); refreshLight(); }, { size: 'sm', icon: 'copy', title: 'Duplicate scene' }),
      btn('', () => move(i, -1), { size: 'sm', icon: 'up', title: 'Move up', disabled: i === 0 }),
      btn('', () => move(i, 1), { size: 'sm', icon: 'down', title: 'Move down', disabled: i === scenes.length - 1 }));
    return h('div', { class: 'scene', role: 'listitem', draggable: 'false', dataset: { id: s.id } },
      h('div', { class: 'handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, gripIcon()),
      h('div', { class: 'thumb' }, mediaId ? img(mediaId, '') : (running ? 'Generating…' : 'No image')),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'num' }, `#${pad(s.position)}`), s.scene_code ? h('span', { class: 'num' }, s.scene_code) : null),
        h('h4', null, s.title || 'Untitled scene'),
        h('div', { class: 'meta' },
          badge(s.image_status, `image: ${s.image_status.toLowerCase()}`),
          badge(s.video_status, `video: ${s.video_status.toLowerCase()}`),
          h('span', { class: 'chip' }, `src: ${s.image_source.toLowerCase()}`),
          h('span', { class: 'chip' }, `${s.duration_sec}s`),
          s.candidate_count ? h('span', { class: 'chip' }, `${s.candidate_count} candidate${s.candidate_count > 1 ? 's' : ''}`) : null,
          s.characters ? h('span', { class: 'chip' }, s.characters.slice(0, 40)) : null,
          s.job_state ? badge(s.job_state, `job: ${s.job_state.toLowerCase()}${running ? ` ${s.job_progress}%` : ''}`) : null),
        running ? h('div', { class: 'progress', style: { marginTop: '8px' } }, h('i', { style: { width: `${s.job_progress}%` } })) : null),
      acts);
  }

  async function approve(s, replace = false) {
    try {
      await api.post(`/api/candidates/${s.latest_candidate_id}/approve`, { replaceApproved: replace });
      toast('Image approved.', 'ok'); refreshLight();
    } catch (e) {
      if (e.status === 409 && !replace && await confirmDialog('Replace approved image?', `${e.message}`, { confirmLabel: 'Replace' })) return approve(s, true);
      if (e.status !== 409) toast(e.message, 'err');
    }
  }
  async function reject(s, confirmApproved = false) {
    try {
      await api.post(`/api/candidates/${s.latest_candidate_id}/reject`, { confirmApproved });
      toast('Image rejected (kept for reference).'); refreshLight();
    } catch (e) {
      if (e.status === 409 && !confirmApproved && await confirmDialog('Reject approved image?', e.message, { confirmLabel: 'Reject', danger: true })) return reject(s, true);
      if (e.status !== 409) toast(e.message, 'err');
    }
  }

  async function saveOrder(ids) {
    try { scenes = (await api.put(`/api/projects/${projectId}/scene-order`, { sceneIds: ids })).items; paintBody(); }
    catch (e) { toast(e.message, 'err'); refreshLight(); }
  }
  function move(i, d) {
    const ids = scenes.map((s) => s.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + d, 0, x);
    saveOrder(ids);
  }

  // Drag-and-drop (desktop pointer). Mobile uses the up/down buttons.
  function enableDrag(list) {
    let dragEl = null;
    list.addEventListener('pointerdown', (e) => { const hnd = e.target.closest('.handle'); if (hnd) hnd.parentElement.draggable = true; });
    list.addEventListener('dragstart', (e) => { dragEl = e.target.closest('.scene'); dragEl?.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragEl?.dataset.id || ''); });
    list.addEventListener('dragover', (e) => {
      if (!dragEl) return;
      e.preventDefault();
      const over = e.target.closest('.scene');
      for (const el of list.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
      if (over && over !== dragEl) over.classList.add('drop-target');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const over = e.target.closest('.scene');
      if (!dragEl || !over || over === dragEl) return;
      const ids = scenes.map((s) => s.id).filter((id) => id !== dragEl.dataset.id);
      const idx = ids.indexOf(over.dataset.id);
      const before = scenes.findIndex((s) => s.id === dragEl.dataset.id) > scenes.findIndex((s) => s.id === over.dataset.id);
      ids.splice(before ? idx : idx + 1, 0, dragEl.dataset.id);
      saveOrder(ids);
    });
    list.addEventListener('dragend', () => { dragEl?.classList.remove('dragging'); if (dragEl) dragEl.draggable = false; dragEl = null; for (const el of list.querySelectorAll('.drop-target')) el.classList.remove('drop-target'); });
  }

  // ---------------- Generation ----------------
  function generationPanel() {
    const wrap = h('div', { class: 'stack' });
    const providerSel = select('provider', [['SIMULATED', 'Simulated (demo — no credits)'], ['GOOGLE_FLOW', 'Google Flow (not enabled)']], 'SIMULATED');
    providerSel.options[1].disabled = true;
    const failSel = select('simulate', [['0', 'No simulated failures'], ['1', 'Demo: fail each job once (to test Retry)']], '0');
    const eligible = scenes.filter((s) => s.image_source === 'FLOW' && !['APPROVED', 'SKIPPED'].includes(s.image_status));
    wrap.append(h('section', { class: 'card' },
      h('h2', null, 'Generate images'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, `Queues one background job per scene with image source "Flow" that is not approved or skipped (${eligible.length} eligible). Completed scenes are never regenerated automatically.`),
      h('div', { class: 'notice info', style: { marginBottom: '12px' } }, 'Google Flow automation is disabled in Phase 1. Use the Simulated provider to test the queue, pause/resume, failure/retry and recovery. It creates synthetic placeholder images and consumes no credits.'),
      h('div', { class: 'row' }, h('div', { class: 'grow', style: { minWidth: '220px' } }, providerSel), h('div', { class: 'grow', style: { minWidth: '220px' } }, failSel),
        btn('Start generation', async () => {
          try {
            const body = { provider: providerSel.value };
            if (failSel.value !== '0') body.simulate = { failTimes: Number(failSel.value) };
            const r = await api.post(`/api/projects/${projectId}/generation`, body);
            toast(`${r.queued.length} job(s) queued${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`, 'ok');
            await refreshLight();
          } catch (e) { toast(e.message, 'err'); }
        }, { kind: 'primary', icon: 'play', disabled: eligible.length === 0 }))));
    if (!runs.length) wrap.append(h('div', { class: 'card empty' }, h('p', null, 'No generation runs yet.')));
    for (const r of runs) wrap.append(runCard(r));
    return wrap;
  }

  function runCard(r) {
    const done = r.counts.COMPLETED || 0;
    const pct = r.total ? Math.round((done / r.total) * 100) : 0;
    return h('section', { class: 'card' },
      h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, `Run · ${fmtDate(r.createdAt)}`), badge(r.state), h('span', { class: 'chip' }, r.provider.toLowerCase())),
      h('div', { class: 'row', style: { margin: '10px 0' } },
        h('div', { class: 'progress grow' }, h('i', { style: { width: `${pct}%` } })), h('span', { class: 'muted mono' }, `${done}/${r.total}`)),
      r.resumePoint ? h('div', { class: 'notice', style: { marginBottom: '10px' } },
        h('div', { class: 'row' }, h('span', { class: 'grow' }, `${Object.entries(r.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ')}`),
          btn(`Resume from scene ${pad(r.resumePoint.scenePosition ?? 0)}`, async () => { await api.post(`/api/runs/${r.id}/resume`); refreshLight(); }, { kind: 'primary', size: 'sm', icon: 'play' }))) : null,
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        r.state === 'ACTIVE' ? btn('Pause', async () => { await api.post(`/api/runs/${r.id}/pause`); refreshLight(); }, { size: 'sm', icon: 'pause' }) : null,
        r.state === 'PAUSED' && !r.resumePoint ? btn('Resume', async () => { await api.post(`/api/runs/${r.id}/resume`); refreshLight(); }, { size: 'sm', icon: 'play' }) : null,
        ['ACTIVE', 'PAUSED'].includes(r.state) ? btn('Cancel run', async () => { if (await confirmDialog('Cancel this run?', 'Unfinished jobs are cancelled. Completed images are kept.', { confirmLabel: 'Cancel run', danger: true })) { await api.post(`/api/runs/${r.id}/cancel`); refreshLight(); } }, { size: 'sm', kind: 'ghost' }) : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Scene'), h('th', null, 'State'), h('th', null, 'Progress'), h('th', null, 'Details'), h('th', null, ''))),
        h('tbody', null, r.jobs.map((j) => h('tr', null,
          h('td', null, `#${pad(j.scenePosition ?? 0)} ${j.sceneTitle || ''}`),
          h('td', null, badge(j.state)),
          h('td', { style: { minWidth: '90px' } }, h('div', { class: 'progress' }, h('i', { style: { width: `${j.progress}%` } }))),
          h('td', { class: 'muted' }, j.errorSummary || (j.retryCount ? `retried ${j.retryCount}×` : '')),
          h('td', null, h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
            ['FAILED', 'INTERRUPTED'].includes(j.state) ? btn('Retry', () => jobAct(j, 'retry'), { size: 'sm', icon: 'retry' }) : null,
            ACTIVE.includes(j.state) ? btn('', () => jobAct(j, 'pause'), { size: 'sm', icon: 'pause', title: 'Pause job' }) : null,
            j.state === 'PAUSED' ? btn('', () => jobAct(j, 'resume'), { size: 'sm', icon: 'play', title: 'Resume job' }) : null,
            ['QUEUED', 'PAUSED', 'FAILED', 'INTERRUPTED', ...ACTIVE].includes(j.state) ? btn('', () => jobAct(j, 'skip'), { size: 'sm', icon: 'skip', title: 'Skip job' }) : null))))))));
  }
  async function jobAct(j, action) {
    try { await api.post(`/api/jobs/${j.id}/${action}`); await refreshLight(); } catch (e) { toast(e.message, 'err'); }
  }

  mount(main, head, wfBox, tabsBox, body);
  await loadAll();
  return () => stopPoll();
}
