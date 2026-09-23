// App bootstrap: session check, shell layout, client-side router.
import { h, mount, btn, toast } from './dom.js';
import { icon } from './icons.js';
import { api, setCsrf } from './api.js';

export const NAV = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: 'dashboard' },
  { key: 'projects', label: 'Projects', path: '/projects', icon: 'projects' },
  { key: 'characters', label: 'Characters', path: '/characters', icon: 'characters' },
  { key: 'assets', label: 'Assets', path: '/assets', icon: 'assets' },
  { key: 'generation', label: 'Generation', path: '/generation', icon: 'generation' },
  { key: 'editor', label: 'Editor', path: '/editor', icon: 'editor', soon: true },
  { key: 'audio', label: 'Audio', path: '/audio', icon: 'audio', soon: true },
  { key: 'subtitles', label: 'Subtitles', path: '/subtitles', icon: 'subtitles', soon: true },
  { key: 'brand', label: 'Brand Kit', path: '/brand-kit', icon: 'brand', soon: true },
  { key: 'thumbnail', label: 'Thumbnail Studio', path: '/thumbnails', icon: 'thumbnail', soon: true },
  { key: 'exports', label: 'Exports', path: '/exports', icon: 'exports', soon: true },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];
const MOBILE_NAV = ['dashboard', 'projects', 'generation', 'characters'];

const ROUTES = [
  [/^\/$/, 'dashboard', () => import('./views/dashboard.js')],
  [/^\/projects$/, 'projects', () => import('./views/projects.js')],
  [/^\/projects\/([0-9a-f-]{36})$/, 'projects', () => import('./views/project.js')],
  [/^\/scenes\/([0-9a-f-]{36})$/, 'projects', () => import('./views/scene.js')],
  [/^\/characters$/, 'characters', () => import('./views/library.js'), { kind: 'character' }],
  [/^\/assets$/, 'assets', () => import('./views/library.js'), { kind: 'asset' }],
  [/^\/generation$/, 'generation', () => import('./views/generation.js')],
  [/^\/settings$/, 'settings', () => import('./views/settings.js')],
];

export const state = { user: null };
let shell = null;
let cleanup = null;

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  render();
}

function buildShell() {
  const main = h('main', { class: 'main', id: 'main' });
  const title = h('div', { class: 'title' }, 'ASK AI Video Studio');
  const root = h('div', { class: 'shell' });
  const navLink = (n) => h('a', { href: n.path, class: 'nav-item', dataset: { key: n.key }, onclick: () => root.classList.remove('nav-open') },
    icon(n.icon), n.label, n.soon ? h('span', { class: 'soon' }, 'SOON') : null);
  const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Main navigation' },
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, icon('play')), h('div', null, 'ASK AI', h('small', null, 'Video Studio'))),
    NAV.map(navLink),
    h('div', { class: 'nav-spacer' }),
    h('div', { class: 'userbox' }, h('strong', null, state.user.displayName), h('span', null, state.user.email),
      h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Sign out', logout, { kind: 'ghost', size: 'sm', icon: 'logout' }))));
  const topbar = h('header', { class: 'topbar' },
    btn('', () => root.classList.toggle('nav-open'), { kind: 'ghost', icon: 'menu', title: 'Menu', size: 'icon-btn' }), title);
  const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Quick navigation' },
    NAV.filter((n) => MOBILE_NAV.includes(n.key)).map((n) => h('a', { href: n.path, dataset: { key: n.key } }, icon(n.icon), n.label)),
    h('a', { href: '#', dataset: { key: 'more' }, onclick: (e) => { e.preventDefault(); root.classList.add('nav-open'); } }, icon('more'), 'More'));
  root.append(sidebar, h('div', { style: { minWidth: 0 } }, topbar, main), bottom);
  return { root, main, title };
}

async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
  state.user = null; shell = null; setCsrf(null);
  navigate('/', { replace: true });
}

export function setTitle(t) {
  document.title = t ? `${t} · ASK AI Video Studio` : 'ASK AI Video Studio';
  if (shell) shell.title.textContent = t || 'ASK AI Video Studio';
}

async function render() {
  cleanup?.(); cleanup = null;
  const app = document.getElementById('app');
  if (!state.user) {
    const { renderLogin } = await import('./views/login.js');
    mount(app, renderLogin(async (me) => { state.user = me.user; setCsrf(me.csrfToken); render(); }));
    return;
  }
  if (!shell) { shell = buildShell(); mount(app, shell.root); }
  const path = location.pathname;
  let found = null;
  for (const [re, key, loader, opts] of ROUTES) { const m = path.match(re); if (m) { found = { key, loader, params: m.slice(1), opts }; break; } }
  const navItem = NAV.find((n) => n.path === path);
  const activeKey = found?.key || navItem?.key;
  for (const a of shell.root.querySelectorAll('[data-key]')) a.classList.toggle('active', a.dataset.key === activeKey);
  const main = shell.main;
  window.scrollTo(0, 0);
  try {
    if (found) {
      const mod = await found.loader();
      cleanup = (await mod.render(main, { params: found.params, ...(found.opts || {}) })) || null;
    } else if (navItem?.soon) {
      const { renderComingSoon } = await import('./views/soon.js');
      renderComingSoon(main, navItem);
    } else {
      mount(main, h('div', { class: 'empty' }, h('h3', null, 'Page not found'), btn('Go to dashboard', () => navigate('/'))));
    }
  } catch (err) {
    mount(main, h('div', { class: 'empty' }, h('h3', null, 'Could not load this page'), h('p', null, err.message)));
  }
}

// Intercept same-origin link clicks for SPA navigation.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', render);
window.addEventListener('aavs:unauthorized', () => { if (state.user) { state.user = null; shell = null; toast('Your session ended. Please sign in again.', 'err'); render(); } });

(async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    setCsrf(me.csrfToken);
  } catch { state.user = null; }
  render();
})();
