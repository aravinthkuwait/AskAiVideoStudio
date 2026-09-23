// Minimal .env loader (no dependency). Never overrides variables already set
// in the real environment, and never logs values.
import fs from 'node:fs';

export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvFile(filePath, target = process.env) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (target[k] === undefined) target[k] = v;
  }
  return true;
}
