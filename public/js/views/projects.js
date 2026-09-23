import { h, mount, btn, badge, fmtDate, img, clear, confirmDialog, toast } from '../dom.js';
import { icon } from '../icons.js';
import { api, qs } from '../api.js';
import { navigate, setTitle } from '../app.js';
import { openProjectDialog } from './common.js';

export async function render(main) {
  setTitle('Projects');
  let status = 'ACTIVE', q = '', offset = 0;
  const list = h('div', { class: 'grid cols-auto' });
  const more = btn('Load more', () => load(true), { kind: 'ghost' });
  const tabs = h('div', { class: 'tabs' });

  const setTabs = () => mount(tabs, ...[['ACTIVE', 'Active'], ['ARCHIVED', 'Archived']].map(([k, l]) =>
    h('button', { class: `tab ${status === k ? 'active' : ''}`, onclick: () => { status = k; setTabs(); load(); } }, l)));

  async function load(append = false) {
    offset = append ? offset + 24 : 0;
    const data = await api.get(`/api/projects${qs({ status, q, offset, limit: 24 })}`);
    if (!append) clear(list);
    if (!data.items.length && !append) list.append(h('div', { class: 'card empty', style: { gridColumn: '1/-1' } },
      h('h3', null, status === 'ACTIVE' ? 'No projects' : 'No archived projects'), status === 'ACTIVE' ? h('p', null, 'Create your first project to get started.') : null));
    for (const p of data.items) list.append(card(p));
    more.classList.toggle('hidden', !data.hasMore);
  }

  function card(p) {
    const actions = h('div', { class: 'row', onclick: (e) => e.stopPropagation() },
      btn('', () => openProjectDialog(p, () => load()), { kind: 'ghost', size: 'sm', icon: 'edit', title: 'Rename / settings' }),
      btn('', async () => { const c = await api.post(`/api/projects/${p.id}/duplicate`); toast('Project duplicated (scene text copied; images are not).', 'ok'); navigate(`/projects/${c.id}`); }, { kind: 'ghost', size: 'sm', icon: 'copy', title: 'Duplicate' }),
      p.status === 'ACTIVE'
        ? btn('', async () => { if (await confirmDialog('Archive project?', `"${p.title}" will be moved to Archived. Nothing is deleted and you can restore it any time.`, { confirmLabel: 'Archive' })) { await api.post(`/api/projects/${p.id}/archive`); load(); } }, { kind: 'ghost', size: 'sm', icon: 'archive', title: 'Archive' })
        : btn('Restore', async () => { await api.post(`/api/projects/${p.id}/unarchive`); load(); }, { size: 'sm' }));
    return h('article', { class: 'card pcard', tabindex: 0, onclick: () => navigate(`/projects/${p.id}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`/projects/${p.id}`); } },
      h('div', { class: 'thumb' }, p.thumbnail_media_id ? img(p.thumbnail_media_id, '') : icon('projects')),
      h('div', { class: 'row' }, h('h3', { class: 'grow' }, p.title), p.status === 'ARCHIVED' ? badge('ARCHIVED', 'archived') : null),
      h('div', { class: 'row' }, h('span', { class: 'chip' }, p.aspect_ratio), h('span', { class: 'chip' }, `${p.scene_duration_sec}s scenes`),
        h('span', { class: 'chip' }, `${p.scene_count} scenes`), h('span', { class: 'chip' }, `${p.approved_count} approved`)),
      h('div', { class: 'row' }, h('span', { class: 'faint grow', style: { fontSize: '12.5px' } }, `Updated ${fmtDate(p.updated_at)}`), actions));
  }

  let t;
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search projects…', 'aria-label': 'Search projects',
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; load(); }, 250); } });

  mount(main,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Projects'), h('p', null, 'Story and script projects.')),
      h('div', { class: 'row' }, search, btn('New project', () => openProjectDialog(null, (p) => navigate(`/projects/${p.id}`)), { kind: 'primary', icon: 'plus' }))),
    tabs, list, h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } }, more));
  setTabs();
  await load();
}
