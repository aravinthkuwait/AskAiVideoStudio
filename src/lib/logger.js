// Structured JSON-lines logger with redaction and size-based rotation.
// Logs are written to <PRIVATE_STORAGE_ROOT>/logs, never inside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { redact, redactString } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

export function createLogger({ dir = null, level = 'info', stdout = true, file = 'app.log' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const filePath = dir ? path.join(dir, file) : null;
  let size = filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

  function rotate() {
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${filePath}.${i + 1}`);
    }
    fs.renameSync(filePath, `${filePath}.1`);
    const oldest = `${filePath}.${MAX_FILES + 1}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    size = 0;
  }

  function write(lvl, component, message, fields = {}) {
    if (LEVELS[lvl] < threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level: lvl,
      component,
      msg: redactString(message),
      ...redact(fields),
    };
    const line = JSON.stringify(entry) + '\n';
    if (filePath) {
      try {
        if (size + line.length > MAX_BYTES && size > 0) rotate();
        fs.appendFileSync(filePath, line, { mode: 0o600 });
        size += Buffer.byteLength(line);
      } catch { /* never crash because of logging */ }
    }
    if (stdout) process.stdout.write(line);
  }

  const make = (component) => ({
    debug: (m, f) => write('debug', component, m, f),
    info: (m, f) => write('info', component, m, f),
    warn: (m, f) => write('warn', component, m, f),
    error: (m, f) => write('error', component, m, f),
    child: (sub) => make(`${component}.${sub}`),
  });
  return make('app');
}

/** Converts an Error to a log-safe summary (message + first frames, redacted). */
export function errorFields(err) {
  if (!err) return {};
  return {
    error: redactString(err.message || String(err)).slice(0, 500),
    code: err.code,
    stack: err.stack ? redactString(err.stack.split('\n').slice(0, 6).join('\n')) : undefined,
  };
}
