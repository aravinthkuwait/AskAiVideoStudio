import { h, mount, clear, btn, badge, fmtDate, toast, pad } from '../dom.js';
import { api, qs } from '../api.js';
import { setTitle } from '../app.js';
import { poll } from './common.js';

const ACTIVE = ['QUEUED', 'PREPARING', 'GENERATING', 'DOWNLOADING'];

export async function render(main) {
  setTitle('Generation');
  let filter = 'OPEN';
  const body = h('tbody');
  const tabs = h('div', { class: 'tabs' });
  const paintTabs = () => mount(tabs, ...[['OPEN', 'Open'], ['FAILED', 'Failed'], ['COMPLETED', 'Completed'], ['', 'All']].map(([k, l]) =>
    h('button', { class: `tab ${filter === k ? 'active' : ''}`, onclick: () => { filter = k; paintTabs(); load(); } }, l)));

  let items = [];
  async function load() {
    items = (await api.get(`/api/jobs${qs({ state: filter, limit: 100 })}`)).items;
    clear(body);
    if (!items.length) body.append(h('tr', null, h('td', { colspan: 6, class: 'muted', style: { textAlign: 'center', padding: '28px' } }, 'No jobs.')));
    for (const j of items) {
      body.append(h('tr', null,
        h('td', null, h('a', { href: `/projects/${j.projectId}` }, j.projectTitle)),
        h('td', null, j.sceneId ? h('a', { href: `/scenes/${j.sceneId}` }, `#${pad(j.scenePosition ?? 0)} ${j.sceneTitle || ''}`) : '—'),
        h('td', null, badge(j.state), h('div', { class: 'progress', style: { marginTop: '6px', width: '120px' } }, h('i', { style: { width: `${j.progress}%` } }))),
        h('td', { class: 'faint' }, j.provider.toLowerCase()),
        h('td', { class: 'muted' }, j.errorSummary || fmtDate(j.updatedAt)),
        h('td', null, h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          ['FAILED', 'INTERRUPTED'].includes(j.state) ? btn('Retry', () => act(j, 'retry'), { size: 'sm', icon: 'retry' }) : null,
          ACTIVE.includes(j.state) ? btn('', () => act(j, 'pause'), { size: 'sm', icon: 'pause', title: 'Pause' }) : null,
          j.state === 'PAUSED' ? btn('', () => act(j, 'resume'), { size: 'sm', icon: 'play', title: 'Resume' }) : null,
          !['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(j.state) ? btn('', () => act(j, 'skip'), { size: 'sm', icon: 'skip', title: 'Skip' }) : null))));
    }
  }
  async function act(j, a) { try { await api.post(`/api/jobs/${j.id}/${a}`); load(); } catch (e) { toast(e.message, 'err'); } }
  const stop = poll(async () => { if (items.some((j) => ACTIVE.includes(j.state))) await load(); }, 1500);

  mount(main, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Generation queue'), h('p', null, 'Background jobs across all projects. The UI stays usable while jobs run.'))),
    tabs, h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'Project'), h('th', null, 'Scene'), h('th', null, 'State'), h('th', null, 'Provider'), h('th', null, 'Details'), h('th', null, ''))), body))));
  paintTabs();
  await load();
  return () => stop();
}
