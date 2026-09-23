// Central configuration. All private locations derive from PRIVATE_STORAGE_ROOT,
// which must live OUTSIDE the public source checkout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/envfile.js';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PRIVATE_ROOT_MARKER = '.ask-ai-video-studio-private-root';

// Sub-directories of the private runtime root. Nothing here is ever committed.
export const PRIVATE_DIRS = [
  'config', 'database', 'media', 'uploads', 'thumbnails', 'exports',
  'temp', 'logs', 'backups', 'browser-profiles', 'flow-lab', 'imports',
];

const bool = (v, dflt) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, dflt, min, max) => {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

export class ConfigError extends Error {}

/** Returns true when `child` is equal to or inside `parent`. */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function loadConfig(env = process.env, { loadDotEnv = true } = {}) {
  if (loadDotEnv) loadEnvFile(env.ENV_FILE || path.join(APP_DIR, '.env'), env);

  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : (env.NODE_ENV === 'test' ? 'test' : 'development');
  const production = nodeEnv === 'production';

  if (!env.PRIVATE_STORAGE_ROOT) {
    throw new ConfigError('PRIVATE_STORAGE_ROOT is not set. Set it to an absolute path OUTSIDE the source checkout (see .env.example).');
  }
  const privateRoot = path.resolve(env.PRIVATE_STORAGE_ROOT);
  if (!path.isAbsolute(env.PRIVATE_STORAGE_ROOT)) {
    throw new ConfigError('PRIVATE_STORAGE_ROOT must be an absolute path.');
  }
  if (isInside(APP_DIR, privateRoot) || isInside(privateRoot, APP_DIR)) {
    throw new ConfigError('PRIVATE_STORAGE_ROOT must not overlap the source checkout (public code and private data must stay separate).');
  }

  const appSecret = env.APP_SECRET || '';
  if (production && (appSecret.length < 32 || /CHANGE_ME/i.test(appSecret))) {
    throw new ConfigError('APP_SECRET must be set to a random value of at least 32 characters in production.');
  }

  return Object.freeze({
    nodeEnv,
    production,
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 4310, 1, 65535),
    privateRoot,
    databasePath: env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : path.join(privateRoot, 'database', 'studio.sqlite'),
    appSecret: appSecret || 'development-only-insecure-secret-not-for-production',
    cookieSecure: bool(env.COOKIE_SECURE, production),
    trustProxy: bool(env.TRUST_PROXY, false),
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 25, 1, 2048) * 1024 * 1024,
    workerMode: env.WORKER_MODE === 'external' ? 'external' : 'embedded',
    ffmpegPath: env.FFMPEG_PATH || '',
    chromePath: env.CHROME_PATH || '',
    logLevel: ['debug', 'info', 'warn', 'error'].includes(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info',
    logToStdout: bool(env.LOG_STDOUT, !production),
    flowAutomationEnabled: false, // Hard-disabled in Phase 1 regardless of env (see FLOW_FEASIBILITY.md).
    workerPollMs: int(env.WORKER_POLL_MS, 500, 20, 60000),
    simulatedStepMs: int(env.SIMULATED_STEP_MS, 400, 1, 60000),
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 24 * 7, 1, 24 * 90),
    loginIpLimit: int(env.LOGIN_IP_LIMIT, 20, 1, 100000), // attempts per IP per 15 minutes
  });
}

/**
 * Creates the private runtime layout. Refuses to adopt an existing non-empty
 * directory that was not created by this application (protects unrelated data).
 */
export function preparePrivateRoot(config) {
  const root = config.privateRoot;
  const marker = path.join(root, PRIVATE_ROOT_MARKER);
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root);
    if (entries.length > 0 && !entries.includes(PRIVATE_ROOT_MARKER)) {
      throw new ConfigError('PRIVATE_STORAGE_ROOT points to an existing non-empty directory that does not belong to ASK AI VIDEO STUDIO. Refusing to use it. Choose a new empty directory.');
    }
  } else {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'This directory is the private runtime root of ASK AI VIDEO STUDIO. Never commit it to Git.\n', { mode: 0o600 });
  }
  for (const d of PRIVATE_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true, mode: 0o700 });
}
