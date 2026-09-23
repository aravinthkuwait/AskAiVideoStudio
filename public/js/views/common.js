// Shared view pieces: project form, workflow indicator, pollers.
import { h, field, input, textarea, select, formData, modal, btn, toast } from '../dom.js';
import { api } from '../api.js';

export const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '21:9'];

export function projectForm(p = {}) {
  return h('form', { class: 'form-grid' },
    field('Title', input('title', p.title || '', { required: true, maxlength: 200 }), { full: true }),
    field('Description', textarea('description', p.description || '', { maxlength: 5000 }), { full: true }),
    field('Aspect ratio', select('aspect_ratio', ASPECTS, p.aspect_ratio || '16:9')),
    field('Target scene duration (seconds)', input('scene_duration_sec', p.scene_duration_sec ?? 10, { type: 'number', min: 1, max: 600 })));
}

export function openProjectDialog(existing, onSaved) {
  const form = projectForm(existing || {});
  const save = async (close) => {
    try {
      const data = formData(form);
      const p = existing ? await api.patch(`/api/projects/${existing.id}`, data) : await api.post('/api/projects', data);
      close(); toast(existing ? 'Project saved.' : 'Project created.', 'ok'); onSaved(p);
    } catch (e) { toast(e.message, 'err'); }
  };
  form.addEventListener('submit', (e) => e.preventDefault());
  modal(existing ? 'Project settings' : 'New project', form, {
    actions: [(c) => btn('Cancel', c), (c) => btn(existing ? 'Save' : 'Create project', () => save(c), { kind: 'primary' })],
  });
}

const STATE_LABEL = { completed: 'Completed', current: 'Current', pending: 'Pending', failed: 'Failed' };

export function workflowIndicator(wf) {
  return h('ol', { class: 'workflow', 'aria-label': 'Workflow progress', style: { listStyle: 'none', padding: 0 } },
    wf.steps.map((s) => h('li', { class: `wf-step ${s.state} ${s.available ? '' : 'soon'}`, title: `${s.n} ${s.key} — ${STATE_LABEL[s.state]}${s.available ? '' : ' (coming soon)'}` },
      h('div', { class: 'n' }, s.state === 'completed' ? '✓' : s.state === 'failed' ? '!' : String(s.n)),
      h('div', { class: 't' }, s.key),
      h('div', { class: 'st' }, s.available ? STATE_LABEL[s.state] : 'Soon'))));
}

/** Adaptive poller: runs fn every `ms` while visible; returns stop(). */
export function poll(fn, ms = 1500) {
  let stopped = false, timer = null;
  const loop = async () => {
    if (stopped) return;
    if (!document.hidden) { try { await fn(); } catch { /* keep polling */ } }
    if (!stopped) timer = setTimeout(loop, ms);
  };
  timer = setTimeout(loop, ms);
  return () => { stopped = true; clearTimeout(timer); };
}
