// Character Library + Asset Library (tenant-wide, reusable across projects).
import { h, mount, clear, btn, img, toast, modal, confirmDialog, field, input, textarea, select, formData } from '../dom.js';
import { icon } from '../icons.js';
import { api, qs } from '../api.js';
import { setTitle } from '../app.js';

const CFG = {
  character: {
    title: 'Characters', sub: 'Reusable characters with appearance, costume and continuity notes.', base: '/api/characters', icon: 'characters',
    fields: [['name', 'Name', 'input'], ['role', 'Role', 'input'], ['description', 'Description'], ['appearance', 'Appearance'], ['costume', 'Costume'], ['continuity', 'Continuity notes'], ['voice_notes', 'Voice notes (optional)']],
  },
  asset: {
    title: 'Assets', sub: 'Reusable vehicles, locations, props, logos and reference images.', base: '/api/assets', icon: 'assets',
    fields: [['name', 'Name', 'input'], ['category', 'Category', 'category'], ['description', 'Description']],
  },
};
const CATEGORIES = [['VEHICLE', 'Vehicle'], ['LOCATION', 'Location'], ['PROP', 'Prop'], ['LOGO', 'Logo'], ['REFERENCE', 'Reference image']];

export async function render(main, { kind }) {
  const cfg = CFG[kind];
  setTitle(cfg.title);
  let q = '', category = '', archived = false;
  const grid = h('div', { class: 'grid cols-auto' });

  async function load() {
    const data = await api.get(`${cfg.base}${qs({ q, category, archived: archived ? 'true' : '', limit: 120 })}`);
    clear(grid);
    if (!data.items.length) grid.append(h('div', { class: 'card empty', style: { gridColumn: '1/-1' } }, h('h3', null, `No ${cfg.title.toLowerCase()} yet`), h('p', null, archived ? 'Nothing archived.' : 'Create one to reuse it across projects.')));
    for (const item of data.items) grid.append(card(item));
  }

  function card(item) {
    const pic = kind === 'character' ? item.images[0] : item.preview;
    return h('article', { class: 'card pcard', onclick: () => edit(item) },
      h('div', { class: 'thumb' }, pic ? img(pic.id, item.name) : icon(cfg.icon)),
      h('h3', null, item.name),
      h('div', { class: 'row' }, kind === 'asset' ? h('span', { class: 'chip' }, item.category.toLowerCase()) : (item.role ? h('span', { class: 'chip' }, item.role) : null),
        h('span', { class: 'chip' }, `${item.projects.length} project${item.projects.length === 1 ? '' : 's'}`)),
      h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, (item.description || '').slice(0, 140)));
  }

  async function edit(item) {
    const projects = (await api.get('/api/projects?limit=100')).items;
    const form = h('form', { class: 'form-grid' }, cfg.fields.map(([k, l, t]) =>
      t === 'input' ? field(l, input(k, item?.[k] || '', { maxlength: 200, required: k === 'name' }))
        : t === 'category' ? field(l, select(k, CATEGORIES, item?.category || 'PROP'))
          : field(l, textarea(k, item?.[k] || '', { rows: 3 }), { full: true })));
    form.addEventListener('submit', (e) => e.preventDefault());
    const linked = new Set((item?.projects || []).map((p) => p.id));
    const links = item ? h('div', { class: 'full' }, h('div', { class: 'muted', style: { fontSize: '13px', margin: '6px 0' } }, 'Used in projects'),
      h('div', { class: 'row' }, projects.map((p) => {
        const cb = h('input', { type: 'checkbox', checked: linked.has(p.id), onchange: async () => { try { await api.post(`${cfg.base}/${item.id}/projects`, { projectId: p.id, linked: cb.checked }); } catch (e) { toast(e.message, 'err'); } } });
        return h('label', { class: 'chip', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', padding: '4px 10px' } }, cb, p.title);
      }))) : null;
    const pics = kind === 'character' ? (item?.images || []) : (item?.preview ? [item.preview] : []);
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden', onchange: async () => {
      try { await api.upload(`${cfg.base}/${item.id}/images`, fileIn.files[0]); toast('Image added.', 'ok'); m.close(); load(); } catch (e) { toast(e.message, 'err'); }
    } });
    const images = item ? h('div', { class: 'full' }, h('div', { class: 'muted', style: { fontSize: '13px', margin: '6px 0' } }, kind === 'character' ? 'Reference images' : 'Preview image'),
      h('div', { class: 'row' }, pics.map((p) => h('div', { style: { width: '120px', borderRadius: '8px', overflow: 'hidden' } }, img(p.id, ''))),
        btn(kind === 'character' ? 'Add reference image' : 'Set image', () => fileIn.click(), { size: 'sm', icon: 'upload' }), fileIn)) : null;
    form.append(...[images, links].filter(Boolean));
    const m = modal(item ? `Edit ${item.name}` : `New ${kind}`, form, { wide: true, actions: [
      item ? btn(item.archived_at ? 'Restore' : 'Archive', async () => {
        if (!item.archived_at && !(await confirmDialog('Archive?', 'It will be hidden from the library. Nothing is deleted.', { confirmLabel: 'Archive' }))) return;
        await api.post(`${cfg.base}/${item.id}/${item.archived_at ? 'unarchive' : 'archive'}`); m.close(); load();
      }, { kind: 'ghost' }) : null,
      (c) => btn('Cancel', c),
      (c) => btn('Save', async () => {
        try { const d = formData(form); if (item) await api.patch(`${cfg.base}/${item.id}`, d); else await api.post(cfg.base, d); c(); toast('Saved.', 'ok'); load(); }
        catch (e) { toast(e.details ? e.details.map((x) => `${x.field} ${x.message}`).join('; ') : e.message, 'err'); }
      }, { kind: 'primary' }),
    ].filter(Boolean) });
  }

  let t;
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search…', 'aria-label': 'Search', oninput: (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; load(); }, 250); } });
  const catSel = kind === 'asset' ? select('category', [['', 'All categories'], ...CATEGORIES], '') : null;
  catSel?.addEventListener('change', () => { category = catSel.value; load(); });
  const archBtn = btn('Show archived', () => { archived = !archived; archBtn.lastChild.textContent = archived ? 'Show active' : 'Show archived'; load(); }, { kind: 'ghost' });

  mount(main, h('div', { class: 'page-head' }, h('div', null, h('h1', null, cfg.title), h('p', null, cfg.sub)),
    h('div', { class: 'row' }, search, catSel, archBtn, btn(`New ${kind}`, () => edit(null), { kind: 'primary', icon: 'plus' }))), grid);
  await load();
}
