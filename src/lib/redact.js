// Redaction of sensitive keys/values before anything is logged or audited.
const SENSITIVE_KEY = /(pass(word|wd)?|secret|token|authori[sz]ation|cookie|session|api[-_]?key|access[-_]?key|private[-_]?key|credential|csrf|signature)/i;

const VALUE_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  [/\b(ya29\.|AIza)[A-Za-z0-9_-]{10,}/g, '[REDACTED_GOOGLE_TOKEN]'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
  [/((?:password|passwd|secret|token|api_key|apikey|cookie|session)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1[REDACTED]'],
];

export function redactString(s) {
  let out = String(s);
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value).slice(0, 2000);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}
