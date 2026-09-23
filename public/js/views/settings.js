import { h, mount, btn, badge, fmtBytes, fmtDate, toast, field, input, confirmDialog } from '../dom.js';
import { api } from '../api.js';
import { setTitle, state } from '../app.js';

export async function render(main) {
  setTitle('Settings');
  const isAdmin = ['owner', 'admin'].includes(state.user.role);
  const sections = h('div', { class: 'stack' });
  mount(main, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'), h('p', null, 'Account, storage, diagnostics and the Flow Feasibility Lab.'))), sections);

  // Account
  const pwForm = h('form', { class: 'form-grid' },
    field('Current password', input('current', '', { type: 'password', autocomplete: 'current-password' })),
    field('New password (min 12 characters)', input('next', '', { type: 'password', autocomplete: 'new-password', minlength: 12 })));
  pwForm.addEventListener('submit', (e) => e.preventDefault());
  sections.append(h('section', { class: 'card' }, h('h2', null, 'Account'),
    h('dl', { class: 'kv' }, h('dt', null, 'Name'), h('dd', null, state.user.displayName), h('dt', null, 'Email'), h('dd', null, state.user.email), h('dt', null, 'Role'), h('dd', null, state.user.role)),
    h('h3', { style: { marginTop: '18px' } }, 'Change password'), pwForm,
    h('div', { class: 'row', style: { marginTop: '12px' } }, btn('Change password', async () => {
      try { await api.post('/api/auth/password', { current: pwForm.current.value, next: pwForm.next.value }); toast('Password changed. Please sign in again.', 'ok'); setTimeout(() => location.reload(), 900); }
      catch (e) { toast(e.message, 'err'); }
    }, { kind: 'primary' }))));

  // Storage
  const storage = await api.get('/api/system/storage');
  const tile = (k, v) => h('div', { class: 'card stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, fmtBytes(v.bytes)), h('div', { class: 'faint' }, `${v.files} file(s)`));
  sections.append(h('section', { class: 'card' }, h('h2', null, 'Storage'),
    h('div', { class: 'grid cols-4' }, tile('Images', storage.images), tile('Videos', storage.videos), tile('Audio', storage.audio), tile('Exports', storage.exports)),
    storage.temporaryBytes !== undefined ? h('p', { class: 'muted' }, `Temporary files: ${fmtBytes(storage.temporaryBytes)} (stale uploads are cleaned automatically at start-up).`) : null,
    h('div', { class: 'table-wrap', style: { marginTop: '12px' } }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Project'), h('th', null, 'Files'), h('th', null, 'Size'))),
      h('tbody', null, storage.projects.map((p) => h('tr', null, h('td', null, p.title), h('td', null, String(p.files)), h('td', null, fmtBytes(p.bytes)))))))));

  // Flow accounts (future)
  const accounts = await api.get('/api/flow-accounts');
  sections.append(h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Flow accounts'), badge('pending', 'coming soon')),
    h('p', { class: 'muted' }, 'Multiple isolated, manually signed-in Google browser profiles. Passwords are never stored. Accounts are switched only when you select one — never rotated automatically.'),
    h('div', { class: 'notice' }, accounts.note)));

  if (!isAdmin) return;

  // Diagnostics
  const diagBox = h('div');
  const loadDiag = async () => {
    const d = await api.get('/api/system/diagnostics');
    const ok = (b) => badge(b ? 'ok' : 'err', b ? 'available' : 'not available');
    mount(diagBox, h('dl', { class: 'kv' },
      h('dt', null, 'Application'), h('dd', null, badge('ok', d.application.status), ` v${d.application.version} · ${d.application.env} · up ${Math.round(d.application.uptimeSec / 60)} min · Node ${d.application.node}`),
      h('dt', null, 'Database'), h('dd', null, badge(d.database.status === 'ok' ? 'ok' : 'err', d.database.status)),
      h('dt', null, 'Worker'), h('dd', null, `${d.worker.mode}${d.worker.running !== undefined ? (d.worker.running ? ' · running' : ' · stopped') : ''}${d.worker.lastTickAt ? ` · last tick ${fmtDate(d.worker.lastTickAt)}` : ''}`),
      h('dt', null, 'Queue'), h('dd', null, Object.entries(d.queue).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'empty'),
      h('dt', null, 'Disk (private storage)'), h('dd', null, d.disk ? `${fmtBytes(d.disk.freeBytes)} free of ${fmtBytes(d.disk.totalBytes)}` : 'unknown'),
      h('dt', null, 'FFmpeg'), h('dd', null, ok(d.ffmpeg.available), d.ffmpeg.version ? ` ${d.ffmpeg.version}` : ''),
      h('dt', null, 'Browser worker'), h('dd', null, ok(d.browserWorker.available), d.browserWorker.version ? ` ${d.browserWorker.version}` : '', ' · Flow automation disabled')));
  };
  sections.append(h('section', { class: 'card' }, h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Diagnostics'), btn('Refresh', loadDiag, { size: 'sm', icon: 'retry' })), diagBox));
  await loadDiag();

  // Flow Feasibility Lab
  const labBox = h('div');
  const paintLab = (r) => mount(labBox, r ? h('div', null,
    h('p', { class: 'muted' }, `Last run ${fmtDate(r.ranAt)} · credits consumed: ${r.creditsConsumed ? 'YES' : 'no'} · production automation: disabled`),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Check'), h('th', null, 'Status'), h('th', null, 'Detail'))),
      h('tbody', null, r.items.map((i) => h('tr', null, h('td', null, i.label), h('td', null, badge(i.status.replace(/ /g, '-'), i.status)), h('td', { class: 'muted' }, i.detail)))))))
    : h('p', { class: 'muted' }, 'No lab report yet.'));
  const runLab = async (checkReachability) => {
    try { const r = await api.post('/api/flow-lab/run', { checkReachability }); paintLab(r.report); toast('Lab checks finished.', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  sections.append(h('section', { class: 'card' }, h('h2', null, 'Flow Feasibility Lab'),
    h('div', { class: 'notice info', style: { marginBottom: '12px' } }, 'Isolated from production. Safe checks never sign in, never open a Flow project and never consume Google credits. Any test that could consume credits will ask for explicit approval first and is not available in Phase 1.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      btn('Run safe checks', () => runLab(false), { kind: 'primary', icon: 'lab' }),
      btn('Also check network reachability', async () => {
        if (await confirmDialog('Check reachability?', 'Makes ONE unauthenticated HTTPS request to the public Google Flow address. No login, no cookies, no credits.', { confirmLabel: 'Run check' })) runLab(true);
      }, { kind: 'ghost' })),
    labBox));
  paintLab((await api.get('/api/flow-lab')).report);
}
