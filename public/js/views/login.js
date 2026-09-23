import { h, btn } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';

export function renderLogin(onSuccess) {
  const err = h('p', { class: 'hidden', style: { color: 'var(--err)', margin: '0' }, role: 'alert' });
  const submit = btn('Sign in', null, { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true; err.classList.add('hidden');
    try {
      const me = await api.post('/api/auth/login', { email: form.email.value, password: form.password.value });
      onSuccess(me);
    } catch (ex) {
      err.textContent = ex.message; err.classList.remove('hidden');
    } finally { submit.disabled = false; }
  } },
  h('label', { class: 'field' }, 'Email', h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'username', required: true })),
  h('label', { class: 'field' }, 'Password', h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
  err, submit);
  return h('div', { class: 'auth' }, h('div', { class: 'card' },
    h('div', { class: 'brand-mark', style: { width: '44px', height: '44px', borderRadius: '13px' } }, icon('play')),
    h('h1', null, 'ASK AI Video Studio'),
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'Sign in to your studio.'),
    form,
    h('p', { class: 'faint', style: { fontSize: '12.5px', marginBottom: 0 } }, 'Accounts are created by the studio administrator from the server command line.')));
}
