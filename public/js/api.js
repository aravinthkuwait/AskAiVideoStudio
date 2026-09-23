// API client. Sends the CSRF token header on every state-changing request.
let csrfToken = null;
export const setCsrf = (t) => { csrfToken = t; };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

async function request(method, url, body, { raw = false, headers = {}, signal } = {}) {
  const opts = { method, headers: { Accept: 'application/json', ...headers }, credentials: 'same-origin', signal };
  if (method !== 'GET' && csrfToken) opts.headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  } else if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = '{}';
  }
  const res = await fetch(url, opts);
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('aavs:unauthorized'));
    throw err;
  }
  return data;
}

export const api = {
  get: (url, o) => request('GET', url, undefined, o),
  post: (url, body, o) => request('POST', url, body, o),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file, { filename } = {}) => request('POST', url, file, {
    raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(filename || file.name || 'upload') },
  }),
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
