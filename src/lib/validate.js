// Tiny declarative validator (avoids a runtime dependency).
// Schema: { field: { type, required, min, max, enum, pattern, trim, default } }
import { validationError } from './errors.js';

export function validate(input, schema, { partial = false } = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const issues = [];
  for (const [key, rule] of Object.entries(schema)) {
    let v = src[key];
    if (v === undefined || v === null || v === '') {
      if (partial) continue;
      if (rule.required) { issues.push({ field: key, message: 'is required' }); continue; }
      if (rule.default !== undefined) out[key] = rule.default;
      else if (v === '' || v === null) out[key] = rule.type === 'string' ? '' : null;
      continue;
    }
    switch (rule.type) {
      case 'string': {
        if (typeof v !== 'string') { issues.push({ field: key, message: 'must be text' }); continue; }
        if (rule.trim !== false) v = v.trim();
        // strip ASCII control chars except tab/newline
        v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
        if (rule.min && v.length < rule.min) issues.push({ field: key, message: `must be at least ${rule.min} characters` });
        if (rule.max && v.length > rule.max) issues.push({ field: key, message: `must be at most ${rule.max} characters` });
        if (rule.pattern && !rule.pattern.test(v)) issues.push({ field: key, message: 'has an invalid format' });
        break;
      }
      case 'int': case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n) || (rule.type === 'int' && !Number.isInteger(n))) { issues.push({ field: key, message: 'must be a number' }); continue; }
        if (rule.min !== undefined && n < rule.min) issues.push({ field: key, message: `must be ≥ ${rule.min}` });
        if (rule.max !== undefined && n > rule.max) issues.push({ field: key, message: `must be ≤ ${rule.max}` });
        v = n;
        break;
      }
      case 'bool':
        if (typeof v !== 'boolean') { issues.push({ field: key, message: 'must be true or false' }); continue; }
        break;
      case 'id':
        if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) { issues.push({ field: key, message: 'is not a valid id' }); continue; }
        break;
      case 'ids':
        if (!Array.isArray(v) || v.length > (rule.max ?? 5000) || !v.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x))) {
          issues.push({ field: key, message: 'must be a list of ids' }); continue;
        }
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) { issues.push({ field: key, message: 'must be an object' }); continue; }
        break;
      case 'array':
        if (!Array.isArray(v)) { issues.push({ field: key, message: 'must be a list' }); continue; }
        if (rule.max && v.length > rule.max) issues.push({ field: key, message: `must have at most ${rule.max} items` });
        break;
      default: break;
    }
    if (rule.enum && !rule.enum.includes(v)) { issues.push({ field: key, message: `must be one of ${rule.enum.join(', ')}` }); continue; }
    out[key] = v;
  }
  if (issues.length) throw validationError(issues);
  return out;
}

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '21:9'];
