// Master Script importer: paste/upload → validate → preview → correct → confirm.
import { h, modal, btn, toast, textarea, mount } from '../dom.js';
import { api } from '../api.js';

const EXAMPLE = `SCENE_ID: S001
TITLE: Arrival at the harbour
DESCRIPTION: A fictional explorer steps off a small boat at dawn.
CHARACTERS: Explorer Nova
LOCATION: Misty harbour
IMAGE_PROMPT: Cinematic wide shot of a misty harbour at dawn, a lone explorer on the pier
VIDEO_PROMPT: Slow dolly-in towards the explorer as mist drifts
DIALOGUE: NOVA: We made it.
CAMERA: Wide, slow dolly-in
LIGHTING: Soft golden dawn light
DURATION: 10
---
SCENE_ID: S002
TITLE: The map
IMAGE_PROMPT: Close-up of weathered hands unfolding an old map on a wooden table
DURATION: 8`;

export function openScriptImporter(project, onDone) {
  const text = textarea('script', '', { class: 'code', placeholder: EXAMPLE, 'aria-label': 'Master Script' });
  const fileInput = h('input', { type: 'file', accept: '.txt,.md,.json,text/plain,application/json', class: 'hidden',
    onchange: async () => { const f = fileInput.files[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) return toast('File is larger than 2 MB.', 'err'); text.value = await f.text(); } });
  const previewBox = h('div', { style: { marginTop: '14px' } });
  let lastPreviewText = null, canImport = false;
  const importBtn = btn('Import scenes', null, { kind: 'primary', disabled: true });

  async function doPreview() {
    try {
      const p = await api.post(`/api/projects/${project.id}/script/preview`, { text: text.value });
      lastPreviewText = text.value;
      canImport = p.canImport;
      importBtn.disabled = !canImport;
      renderPreview(p);
    } catch (e) { toast(e.message, 'err'); }
  }
  text.addEventListener('input', () => { if (text.value !== lastPreviewText) { importBtn.disabled = true; } });

  function renderPreview(p) {
    const s = p.summary || { total: 0, withErrors: 0, withWarnings: 0 };
    mount(previewBox,
      h('div', { class: `notice ${p.canImport ? 'info' : ''}`, style: { marginBottom: '10px' } },
        p.errors.length ? p.errors.join(' ') : `${s.total} scene(s) found (${(p.format || '').toUpperCase()}). ${s.withErrors} with errors, ${s.withWarnings} with warnings.${p.canImport ? ' Review, then confirm the import.' : ' Fix the errors in the text above and preview again.'}`),
      p.scenes.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Scene ID / Title'), h('th', null, 'Image prompt'), h('th', null, 'Duration'), h('th', null, 'Issues'))),
        h('tbody', null, p.scenes.map((sc) => h('tr', { class: sc.errors.length ? 'err' : '' },
          h('td', { class: 'mono' }, String(sc.index + 1)),
          h('td', null, h('div', { class: 'mono faint' }, sc.fields.SCENE_ID || '—'), h('div', null, sc.fields.TITLE || '(no title)')),
          h('td', { class: 'muted', style: { maxWidth: '360px' } }, (sc.fields.IMAGE_PROMPT || '—').slice(0, 220)),
          h('td', { class: 'mono' }, sc.draft?.duration_sec ? `${sc.draft.duration_sec}s` : '—'),
          h('td', null, h('ul', { class: 'issues' },
            sc.errors.map((e) => h('li', { class: 'e' }, e)),
            sc.warnings.map((w) => h('li', { class: 'w' }, w)),
            Object.keys(sc.extra || {}).length ? h('li', { class: 'faint' }, `Extra fields preserved: ${Object.keys(sc.extra).join(', ')}`) : null))))))) : null);
  }

  importBtn.addEventListener('click', async () => {
    if (!canImport || text.value !== lastPreviewText) return toast('Preview the script again before importing.', 'err');
    try {
      importBtn.disabled = true;
      const r = await api.post(`/api/projects/${project.id}/script/import`, { text: text.value, confirm: true });
      if (!r.imported) { renderPreview(r.preview); return; }
      toast(`${r.imported} scene(s) imported.`, 'ok');
      m.close(); onDone();
    } catch (e) { toast(e.message, 'err'); importBtn.disabled = false; }
  });

  const m = modal('Import Master Script', h('div', null,
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'Paste text using KEY: value lines (SCENE_ID, TITLE, DESCRIPTION, CHARACTERS, LOCATION, ASSETS, IMAGE_PROMPT, VIDEO_PROMPT, DIALOGUE, CAMERA, LIGHTING, AUDIO_NOTES, BGM_NOTES, SFX_NOTES, NEGATIVE_PROMPT, CONTINUITY_NOTES, DURATION, ASPECT_RATIO). Separate scenes with a new SCENE_ID or a "---" line. JSON ({"scenes": [...]}) is also supported. Nothing is saved until you confirm.'),
    text,
    h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Load file…', () => fileInput.click(), { icon: 'upload', size: 'sm' }), btn('Insert example', () => { text.value = EXAMPLE; }, { size: 'sm', kind: 'ghost' }), fileInput),
    previewBox), { wide: true, actions: [(c) => btn('Cancel', c), btn('Validate & preview', doPreview), importBtn] });
}
