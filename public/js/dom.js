// DOM helpers. All dynamic text is set via textContent (never innerHTML) — XSS-safe by construction.
import { icon } from './icons.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'hidden') el[k] = !!v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
export const mount = (el, ...children) => { clear(el); append(el, children); return el; };

export function btn(label, onClick, { kind = '', icon: ic, title, size, disabled, type = 'button' } = {}) {
  return h('button', { type, class: `btn ${kind} ${size || ''}`.trim(), onclick: onClick, title, disabled, 'aria-label': title || undefined },
    ic ? icon(ic) : null, label);
}

export function badge(state, label) {
  const key = String(state || '').replace(/\s+/g, '-');
  return h('span', { class: `badge s-${key}` }, label ?? String(state || '').replace(/_/g, ' ').toLowerCase());
}

export function toast(message, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, message);
  const box = document.getElementById('toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}

export function modal(title, body, { wide = false, actions = [] } = {}) {
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', null, title), body, actions.length ? h('div', { class: 'foot' }, actions.map((a) => (typeof a === 'function' ? a(close) : a))) : null);
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input, textarea, select, button') || box).focus(), 0);
  return { close, box };
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(title, h('p', { class: 'muted prewrap' }, message), {
      actions: [
        (close) => btn('Cancel', () => { done = true; close(); resolve(false); }),
        (close) => btn(confirmLabel, () => { done = true; close(); resolve(true); }, { kind: danger ? 'danger' : 'primary' }),
      ],
    });
    const obs = new MutationObserver(() => { if (!m.box.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function field(label, input, { full = false, hint } = {}) {
  return h('label', { class: `field ${full ? 'full' : ''}` }, label, input, hint ? h('span', { class: 'faint' }, hint) : null);
}

export function input(name, value = '', attrs = {}) {
  return h('input', { class: 'input', name, value, ...attrs });
}

export function textarea(name, value = '', attrs = {}) {
  const { class: cls = '', ...rest } = attrs;
  const t = h('textarea', { ...rest, class: `input ${cls}`.trim(), name });
  t.value = value ?? '';
  return t;
}

export function select(name, options, value) {
  return h('select', { class: 'input', name }, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: v === value }, l);
  }));
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) if (el.name) out[el.name] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
  return out;
}

export const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};
export const fmtDate = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const pad = (n) => String(n).padStart(2, '0');

export function img(mediaId, alt = '', { thumb = true } = {}) {
  return h('img', { src: `/api/media/${encodeURIComponent(mediaId)}${thumb ? '?size=thumb' : ''}`, alt, loading: 'lazy', decoding: 'async' });
}

export function lightbox(mediaId, title) {
  modal(title || 'Preview', h('div', { class: 'lightbox' }, img(mediaId, title, { thumb: false })), { wide: true, actions: [(c) => btn('Close', c)] });
}
