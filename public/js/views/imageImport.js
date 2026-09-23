// Bulk external / ChatGPT image import with filename → scene MAPPING PREVIEW.
// Files are copied into private storage only after confirmation; originals are never modified.
import { h, modal, btn, toast, mount, select, pad } from '../dom.js';
import { api } from '../api.js';

export function openImageImport(project, scenes, onDone) {
  if (!scenes.length) return toast('Import a script or add scenes first.', 'err');
  let files = [];
  let rows = [];
  let source = 'EXTERNAL';
  const box = h('div', { style: { marginTop: '12px' } });
  const pick = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp', class: 'hidden', onchange: () => choose([...pick.files], 'EXTERNAL') });
  const pickFolder = h('input', { type: 'file', multiple: true, webkitdirectory: true, class: 'hidden', onchange: () => choose([...pickFolder.files].filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name)), 'FOLDER') });
  const drop = h('div', { class: 'dropzone' }, 'Drop images here (e.g. Scene_001.png, Scene_002.jpg, S003.webp)', h('br'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } }, btn('Choose images…', () => pick.click(), { icon: 'upload', size: 'sm' }), btn('Choose folder…', () => pickFolder.click(), { icon: 'folder', size: 'sm' })), pick, pickFolder);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); choose([...e.dataTransfer.files], 'EXTERNAL'); });
  const confirmBtn = btn('Confirm & import', null, { kind: 'primary', disabled: true });

  async function choose(list, src) {
    files = list.slice(0, 500); source = src;
    if (!files.length) return;
    try {
      const r = await api.post(`/api/projects/${project.id}/image-mapping/preview`, { filenames: files.map((f) => f.name) });
      rows = r.rows.map((row, i) => ({ ...row, file: files[i], target: row.sceneId || '' }));
      renderRows(r);
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderRows(r) {
    const opts = [['', '— skip this file —'], ...scenes.map((s) => [s.id, `#${pad(s.position)} ${s.title || s.scene_code || ''}`.slice(0, 60)])];
    mount(box,
      h('div', { class: 'notice info', style: { marginBottom: '10px' } }, `MAPPING PREVIEW — ${r.matched} matched, ${r.unmatched} unmatched. Adjust any row, then confirm. Images are added as candidates; approved images are never replaced.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'File'), h('th', null, 'Size'), h('th', null, 'Scene'), h('th', null, 'Note'))),
        h('tbody', null, rows.map((row) => {
          const sel = select('scene', opts, row.target);
          sel.addEventListener('change', () => { row.target = sel.value; update(); });
          return h('tr', null, h('td', { class: 'mono' }, row.filename), h('td', { class: 'faint' }, `${Math.round(row.file.size / 1024)} KB`), h('td', null, sel), h('td', { class: 'muted' }, row.issue || (row.rule ? `matched by ${row.rule.toLowerCase()}` : '')));
        })))));
    update();
  }
  const update = () => { const n = rows.filter((r) => r.target).length; confirmBtn.disabled = n === 0; confirmBtn.textContent = `Confirm & import ${n}`; };

  confirmBtn.addEventListener('click', async () => {
    const todo = rows.filter((r) => r.target);
    confirmBtn.disabled = true;
    let ok = 0, failed = 0;
    for (const [i, r] of todo.entries()) {
      confirmBtn.textContent = `Uploading ${i + 1}/${todo.length}…`;
      try { await api.upload(`/api/scenes/${r.target}/candidates?source=${source}`, r.file, { filename: r.filename }); ok++; }
      catch (e) { failed++; toast(`${r.filename}: ${e.message}`, 'err'); }
    }
    toast(`${ok} image(s) imported${failed ? `, ${failed} failed` : ''}.`, failed ? 'err' : 'ok');
    m.close(); onDone();
  });

  const m = modal('Import external / ChatGPT images', h('div', null,
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'Files are matched to scenes by name (Scene_001, S003, 003) or by SCENE_ID. Your original files are copied, never modified.'),
    drop, box), { wide: true, actions: [(c) => btn('Cancel', c), confirmBtn] });
}
