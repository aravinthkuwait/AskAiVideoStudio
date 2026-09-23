import { h, mount, btn, badge, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { navigate, setTitle, state } from '../app.js';
import { openProjectDialog } from './common.js';

export async function render(main) {
  setTitle('Dashboard');
  const [projects, jobs] = await Promise.all([api.get('/api/projects?limit=6'), api.get('/api/jobs?state=OPEN&limit=8')]);
  const totalScenes = projects.items.reduce((a, p) => a + p.scene_count, 0);
  const approved = projects.items.reduce((a, p) => a + p.approved_count, 0);
  const stat = (k, v) => h('div', { class: 'card stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)));

  mount(main,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, `Welcome back, ${state.user.displayName}`), h('p', null, 'Your AI production studio.')),
      btn('New project', () => openProjectDialog(null, (p) => navigate(`/projects/${p.id}`)), { kind: 'primary', icon: 'plus' })),
    h('div', { class: 'grid cols-4', style: { marginBottom: '22px' } },
      stat('Recent projects', projects.items.length + (projects.hasMore ? '+' : '')),
      stat('Scenes', totalScenes), stat('Approved images', approved), stat('Active jobs', jobs.items.length)),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card' }, h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Recent projects'), h('a', { href: '/projects', class: 'muted' }, 'View all →')),
        projects.items.length ? h('div', { class: 'stack', style: { gap: '8px' } }, projects.items.map((p) =>
          h('a', { href: `/projects/${p.id}`, class: 'row', style: { padding: '8px', borderRadius: '10px' } },
            h('div', { class: 'grow' }, h('strong', null, p.title), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, `${p.scene_count} scenes · ${p.approved_count} approved · updated ${fmtDate(p.updated_at)}`)),
            h('span', { class: 'chip' }, p.aspect_ratio))))
          : h('div', { class: 'empty' }, h('h3', null, 'No projects yet'), h('p', null, 'Create a project, then import your Master Script.'))),
      h('section', { class: 'card' }, h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Generation queue'), h('a', { href: '/generation', class: 'muted' }, 'Open →')),
        jobs.items.length ? h('div', { class: 'stack', style: { gap: '10px' } }, jobs.items.map((j) =>
          h('div', null, h('div', { class: 'row' }, h('span', { class: 'grow' }, `${j.projectTitle} · Scene ${j.scenePosition ?? '–'}`), badge(j.state)),
            h('div', { class: 'progress', style: { marginTop: '6px' } }, h('i', { style: { width: `${j.progress}%` } })))))
          : h('div', { class: 'empty' }, h('p', null, 'No active jobs.')))));
}
