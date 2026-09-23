import { h, mount, btn, badge, fmtDate, fmtBytes, img, toast, confirmDialog, modal, lightbox, pad, field, input, textarea, select, formData } from '../dom.js';
import { api } from '../api.js';
import { navigate, setTitle } from '../app.js';
import { ASPECTS, poll } from './common.js';

const SOURCES = [['FLOW', 'Google Flow (default)'], ['EXTERNAL', 'ChatGPT / external image'], ['UPLOAD', 'Manual upload'], ['FOLDER', 'Imported folder image'], ['ASSET', 'Existing project asset']];
const LONG = [['description', 'Description'], ['image_prompt', 'Image prompt'], ['video_prompt', 'Video prompt'], ['negative_prompt', 'Negative prompt'], ['dialogue', 'Dialogue'],
  ['continuity_notes', 'Continuity notes'], ['audio_notes', 'Audio notes'], ['bgm_notes', 'BGM notes'], ['sfx_notes', 'SFX notes']];
const SHORT = [['characters', 'Characters'], ['location', 'Location'], ['assets', 'Assets'], ['camera', 'Camera'], ['lighting', 'Lighting']];

export async function render(main, { params: [sceneId] }) {
  let scene, candidates, dirty = false;
  const candBox = h('div');
  const formBox = h('div');
  const headBox = h('div');

  async function load() {
    const d = await api.get(`/api/scenes/${sceneId}`);
    scene = d.scene; candidates = d.candidates;
    setTitle(`Scene ${pad(scene.position)}`);
    paintHead(); paintCands();
    if (!dirty) paintForm();
  }
  const stop = poll(async () => { if (['QUEUED', 'GENERATING'].includes(scene?.image_status)) await load(); }, 1500);

  function paintHead() {
    mount(headBox, h('div', { class: 'page-head' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'crumbs' }, h('a', { href: '/projects' }, 'Projects'), ' / ', h('a', { href: `/projects/${scene.project_id}` }, 'Project'), ' / '),
        h('h1', null, `#${pad(scene.position)} ${scene.title || 'Untitled scene'}`),
        h('div', { class: 'row', style: { marginTop: '6px' } }, badge(scene.image_status, `image: ${scene.image_status.toLowerCase()}`), badge(scene.video_status, `video: ${scene.video_status.toLowerCase()}`),
          h('span', { class: 'chip' }, `source: ${scene.image_source.toLowerCase()}`))),
      h('div', { class: 'row' },
        scene.image_status === 'FAILED' ? btn('Retry generation', async () => { await api.post(`/api/scenes/${sceneId}/retry`); toast('Queued.', 'ok'); load(); }, { icon: 'retry' }) : null,
        btn(scene.image_status === 'SKIPPED' ? 'Unskip' : 'Skip', async () => { await api.post(`/api/scenes/${sceneId}/skip`, { skipped: scene.image_status !== 'SKIPPED' }); load(); }, { icon: 'skip' }),
        btn('Duplicate', async () => { const s = await api.post(`/api/scenes/${sceneId}/duplicate`); navigate(`/scenes/${s.id}`); }, { icon: 'copy' }),
        btn('Remove', async () => {
          if (await confirmDialog('Remove scene?', 'The scene is hidden from the project (soft delete). Its images stay in private storage.', { confirmLabel: 'Remove', danger: true })) {
            await api.del(`/api/scenes/${sceneId}`); navigate(`/projects/${scene.project_id}`);
          }
        }, { kind: 'danger' }))));
  }

  function paintForm() {
    const form = h('form', { class: 'form-grid', oninput: () => { dirty = true; saveBtn.disabled = false; } },
      field('Title', input('title', scene.title, { maxlength: 300 })),
      field('Scene ID', input('scene_code', scene.scene_code, { maxlength: 64 })),
      field('Duration (seconds)', input('duration_sec', scene.duration_sec, { type: 'number', min: 0.5, max: 600, step: 0.5 })),
      field('Aspect ratio', select('aspect_ratio', ASPECTS, scene.aspect_ratio)),
      field('Image source', select('image_source', SOURCES, scene.image_source), { full: true }),
      ...LONG.map(([k, l]) => field(l, textarea(k, scene[k], { maxlength: 20000, rows: k.includes('prompt') || k === 'description' ? 5 : 3 }), { full: true })),
      ...SHORT.map(([k, l]) => field(l, input(k, scene[k]))),
      Object.keys(scene.extra || {}).length ? h('div', { class: 'full' }, h('div', { class: 'faint' }, 'Extra imported fields (preserved):'),
        h('dl', { class: 'kv' }, Object.entries(scene.extra).flatMap(([k, v]) => [h('dt', { class: 'mono' }, k), h('dd', { class: 'prewrap' }, v)]))) : null);
    form.addEventListener('submit', (e) => e.preventDefault());
    const saveBtn = btn('Save changes', async () => {
      try {
        const d = formData(form);
        await api.patch(`/api/scenes/${sceneId}`, d);
        dirty = false; saveBtn.disabled = true; toast('Scene saved.', 'ok'); load();
      } catch (e) { toast(e.details ? e.details.map((x) => `${x.field} ${x.message}`).join('; ') : e.message, 'err'); }
    }, { kind: 'primary', disabled: true });
    mount(formBox, h('section', { class: 'card' }, h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Scene details & prompts'), saveBtn), form));
  }

  function paintCands() {
    const live = candidates.filter((c) => c.status !== 'REJECTED');
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, class: 'hidden', onchange: () => uploadFiles([...fileIn.files]) });
    const drop = h('div', { class: 'dropzone' }, 'Drop an image here or ', btn('choose file…', () => fileIn.click(), { size: 'sm', icon: 'upload' }), ' ',
      btn('Use library asset…', pickAsset, { size: 'sm', kind: 'ghost' }), fileIn,
      h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, 'PNG, JPEG or WebP. Added as a new candidate. The approved image is never replaced automatically.'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); });

    mount(candBox, h('section', { class: 'card' },
      h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, `Image candidates (${candidates.length})`),
        live.length > 1 ? btn('Compare', () => compare(live), { size: 'sm', icon: 'eye' }) : null),
      candidates.length ? h('div', { class: 'cands', style: { marginBottom: '14px' } }, candidates.map(candCard)) : h('p', { class: 'muted' }, 'No images yet.'),
      drop));
  }

  function candCard(c) {
    return h('div', { class: `card cand ${c.status === 'APPROVED' ? 'approved' : ''} ${c.status === 'REJECTED' ? 'rejected' : ''}` },
      h('div', { class: 'img', onclick: () => lightbox(c.media.id, c.media.originalFilename || 'Candidate') }, img(c.media.id, c.media.originalFilename || 'Image candidate')),
      h('div', { class: 'row' }, badge(c.status), h('span', { class: 'chip' }, c.source.toLowerCase())),
      h('div', { class: 'faint', style: { fontSize: '12px' } }, `${c.media.originalFilename || ''} ${c.media.width ? `· ${c.media.width}×${c.media.height}` : ''} · ${fmtBytes(c.media.bytes)} · ${fmtDate(c.importedAt)}`),
      h('div', { class: 'row' },
        c.status !== 'APPROVED' ? btn('Use this image', () => approve(c), { kind: 'primary', size: 'sm', icon: 'check' }) : h('strong', { style: { color: 'var(--ok)', fontSize: '13px' } }, '✓ Approved — used for video'),
        c.status !== 'REJECTED' ? btn('', () => reject(c), { size: 'sm', icon: 'x', title: 'Reject' }) : null));
  }

  async function approve(c, replaceApproved = false) {
    try { await api.post(`/api/candidates/${c.id}/approve`, { replaceApproved }); toast('Approved. This image will be the video-generation input.', 'ok'); load(); }
    catch (e) {
      if (e.status === 409 && !replaceApproved && await confirmDialog('Replace approved image?', e.message, { confirmLabel: 'Use this image instead' })) return approve(c, true);
      if (e.status !== 409) toast(e.message, 'err');
    }
  }
  async function reject(c, confirmApproved = false) {
    try { await api.post(`/api/candidates/${c.id}/reject`, { confirmApproved }); load(); }
    catch (e) {
      if (e.status === 409 && !confirmApproved && await confirmDialog('Reject the approved image?', e.message, { confirmLabel: 'Reject', danger: true })) return reject(c, true);
      if (e.status !== 409) toast(e.message, 'err');
    }
  }

  async function uploadFiles(files) {
    for (const f of files.slice(0, 20)) {
      try { await api.upload(`/api/scenes/${sceneId}/candidates?source=${scene.image_source === 'EXTERNAL' ? 'EXTERNAL' : 'UPLOAD'}`, f); toast(`${f.name} added.`, 'ok'); }
      catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
    }
    load();
  }

  async function pickAsset() {
    const data = await api.get('/api/assets?limit=100');
    const withImg = data.items.filter((a) => a.preview);
    const m = modal('Use a library asset', withImg.length ? h('div', { class: 'cands' }, withImg.map((a) => h('div', { class: 'card cand' },
      h('div', { class: 'img' }, img(a.preview.id, a.name)), h('strong', null, a.name), h('span', { class: 'chip' }, a.category.toLowerCase()),
      btn('Add as candidate', async () => { try { await api.post(`/api/scenes/${sceneId}/candidates/from-asset`, { assetId: a.id }); m.close(); load(); } catch (e) { toast(e.message, 'err'); } }, { size: 'sm', kind: 'primary' }))))
      : h('p', { class: 'muted' }, 'No assets with images yet. Add them in the Asset Library.'), { wide: true, actions: [(c) => btn('Close', c)] });
  }

  function compare(list) {
    modal('Compare candidates', h('div', { class: 'grid cols-2' }, list.map((c) => h('div', { class: `card cand ${c.status === 'APPROVED' ? 'approved' : ''}` },
      h('div', { class: 'img' }, img(c.media.id, '', { thumb: false })), h('div', { class: 'row' }, badge(c.status), h('span', { class: 'chip' }, c.source.toLowerCase())),
      c.status !== 'APPROVED' ? btn('Use this image', () => { document.querySelector('.modal-back')?.remove(); approve(c); }, { kind: 'primary', size: 'sm' }) : null))),
    { wide: true, actions: [(cl) => btn('Close', cl)] });
  }

  mount(main, headBox, h('div', { class: 'stack' }, candBox, formBox));
  await load();
  return () => stop();
}
