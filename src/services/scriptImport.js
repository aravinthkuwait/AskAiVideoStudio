// Master Script importer. Parses text ("KEY: value" blocks) or JSON into scene
// drafts, preserving all text. Nothing is written until the user confirms.
import { SCENE_TEXT_FIELDS } from './scenes.js';
import { ASPECT_RATIOS } from '../lib/validate.js';

export const SCRIPT_FIELDS = [
  'SCENE_ID', 'TITLE', 'DESCRIPTION', 'CHARACTERS', 'LOCATION', 'ASSETS', 'IMAGE_PROMPT', 'VIDEO_PROMPT', 'DIALOGUE',
  'CAMERA', 'LIGHTING', 'AUDIO_NOTES', 'BGM_NOTES', 'SFX_NOTES', 'NEGATIVE_PROMPT', 'CONTINUITY_NOTES', 'DURATION', 'ASPECT_RATIO',
];
const RECOMMENDED = ['TITLE', 'DESCRIPTION', 'IMAGE_PROMPT', 'VIDEO_PROMPT'];
const TO_COLUMN = { SCENE_ID: 'scene_code', DURATION: 'duration_sec', ASPECT_RATIO: 'aspect_ratio' };
const MAX_SCENES = 1000;
const MAX_INPUT = 2 * 1024 * 1024;

/** Normalise "Image Prompt", "image-prompt", "imagePrompt" → IMAGE_PROMPT. */
export function normaliseKey(k) {
  return String(k).trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toUpperCase();
}

function parseText(text) {
  const scenes = [];
  let cur = null;
  let lastKey = null;
  const keyLine = /^\s*(?:\*\*)?([A-Za-z][A-Za-z _-]{1,40}?)(?:\*\*)?\s*:\s?(.*)$/;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*(?:-{3,}|={3,}|#{1,3}\s*scene\b.*)\s*$/i.test(line)) { if (cur) { scenes.push(cur); cur = null; lastKey = null; } continue; }
    const m = line.match(keyLine);
    const key = m ? normaliseKey(m[1]) : null;
    // Only known keys start a field; e.g. "NARRATOR: ..." inside DIALOGUE stays dialogue.
    if (key && SCRIPT_FIELDS.includes(key)) {
      if (key === 'SCENE_ID' && cur && Object.keys(cur).length) { scenes.push(cur); cur = null; }
      cur ??= {};
      cur[key] = (cur[key] ? cur[key] + '\n' : '') + m[2];
      lastKey = key;
    } else if (cur && lastKey) {
      cur[lastKey] += '\n' + line;
    } else if (line.trim()) {
      // Text before any recognised key: keep it rather than drop it.
      cur ??= {};
      cur.DESCRIPTION = (cur.DESCRIPTION ? cur.DESCRIPTION + '\n' : '') + line;
      lastKey = 'DESCRIPTION';
    }
  }
  if (cur) scenes.push(cur);
  return scenes.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.replace(/\s+$/, '')])));
}

function parseJson(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : Array.isArray(data?.scenes) ? data.scenes : null;
  if (!arr) throw new Error('JSON must be an array of scenes or an object with a "scenes" array.');
  return arr.map((s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { __invalid: true };
    const out = {};
    for (const [k, v] of Object.entries(s)) out[normaliseKey(k)] = Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v));
    return out;
  });
}

/** Parse + validate. Returns a preview: { format, scenes: [{ index, fields, extra, errors, warnings, draft }], errors }. */
export function previewScript(text, { defaultDuration = 10, defaultAspect = '16:9' } = {}) {
  const errors = [];
  if (typeof text !== 'string' || !text.trim()) return { format: null, scenes: [], errors: ['The script is empty.'], canImport: false };
  if (text.length > MAX_INPUT) return { format: null, scenes: [], errors: ['The script is larger than 2 MB.'], canImport: false };
  const trimmed = text.trim();
  let format = 'text';
  let raw;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    format = 'json';
    try { raw = parseJson(trimmed); } catch (e) { return { format, scenes: [], errors: [`Invalid JSON: ${String(e.message).slice(0, 200)}`], canImport: false }; }
  } else {
    raw = parseText(text);
  }
  if (raw.length === 0) errors.push('No scenes were found. Each scene should start with "SCENE_ID:" or be separated by a line of "---".');
  if (raw.length > MAX_SCENES) { errors.push(`Too many scenes (${raw.length}); the maximum is ${MAX_SCENES}.`); raw = raw.slice(0, MAX_SCENES); }

  const seenIds = new Map();
  const scenes = raw.map((fields, index) => {
    const sErrors = [];
    const warnings = [];
    if (fields.__invalid) return { index, fields: {}, extra: {}, errors: ['Scene is not an object.'], warnings, draft: null };
    const draft = { extra: {} };
    for (const [k, v] of Object.entries(fields)) {
      if (SCRIPT_FIELDS.includes(k)) {
        const col = TO_COLUMN[k] || k.toLowerCase();
        if (col in SCENE_TEXT_FIELDS) {
          draft[col] = v;
          if (v.length > (SCENE_TEXT_FIELDS[col].max || 20000)) sErrors.push(`${k} is too long.`);
        }
      } else {
        draft.extra[k] = v; // unknown field: preserved, not lost
      }
    }
    const dur = fields.DURATION?.trim();
    if (dur) {
      const n = Number.parseFloat(dur.replace(/s(ec(onds?)?)?$/i, ''));
      if (!Number.isFinite(n) || n < 0.5 || n > 600) sErrors.push(`DURATION "${dur.slice(0, 20)}" is not a valid number of seconds (0.5–600).`);
      else draft.duration_sec = n;
    } else { warnings.push(`DURATION missing — default ${defaultDuration}s will be used.`); draft.duration_sec = defaultDuration; }
    const ar = fields.ASPECT_RATIO?.trim();
    if (ar) {
      if (!ASPECT_RATIOS.includes(ar)) sErrors.push(`ASPECT_RATIO "${ar.slice(0, 20)}" is not supported (${ASPECT_RATIOS.join(', ')}).`);
      else draft.aspect_ratio = ar;
    } else draft.aspect_ratio = defaultAspect;
    for (const k of RECOMMENDED) if (!fields[k]?.trim()) warnings.push(`${k} is missing.`);
    if (!fields.SCENE_ID?.trim()) warnings.push('SCENE_ID is missing — the scene number will be used.');
    else {
      const id = fields.SCENE_ID.trim();
      if (seenIds.has(id)) sErrors.push(`SCENE_ID "${id.slice(0, 40)}" is duplicated (also scene ${seenIds.get(id) + 1}).`);
      else seenIds.set(id, index);
    }
    if (!Object.values(fields).some((v) => String(v).trim())) sErrors.push('Scene is empty.');
    return { index, fields, extra: draft.extra, errors: sErrors, warnings, draft };
  });

  return {
    format,
    scenes,
    errors,
    summary: {
      total: scenes.length,
      withErrors: scenes.filter((s) => s.errors.length).length,
      withWarnings: scenes.filter((s) => s.warnings.length).length,
    },
    canImport: errors.length === 0 && scenes.length > 0 && scenes.every((s) => s.errors.length === 0),
  };
}
