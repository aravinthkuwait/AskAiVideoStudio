// Application assembly: dependencies, request pipeline, auth, error handling.
import http from 'node:http';
import path from 'node:path';
import { APP_DIR, preparePrivateRoot } from './config.js';
import { openDatabase, migrate } from './persistence/database.js';
import { createLogger, errorFields } from './lib/logger.js';
import { Storage } from './lib/storage.js';
import { AppError, unauthorized, forbidden, notFound, tooMany } from './lib/errors.js';
import { newId } from './lib/ids.js';
import { RateLimiter } from './lib/ratelimit.js';
import { findFfmpeg } from './lib/tools.js';
import { Thumbnailer } from './lib/thumbnails.js';
import { Router } from './http/router.js';
import { parseCookies, serializeCookie, readJson, sendJson } from './http/io.js';
import { applySecurityHeaders, originAllowed } from './http/security.js';
import { createStatic } from './http/static.js';
import { SessionStore, SESSION_COOKIE } from './auth/sessions.js';
import { authenticate, changePassword } from './services/users.js';
import { audit } from './services/audit.js';
import { registerRoutes } from './api/routes.js';
import { createProviderRegistry } from './providers/registry.js';
import { Worker } from './jobs/worker.js';

const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/me']);

export function createApp(config, { logger } = {}) {
  preparePrivateRoot(config);
  const log = logger || createLogger({ dir: path.join(config.privateRoot, 'logs'), level: config.logLevel, stdout: config.logToStdout });
  const db = openDatabase(config.databasePath);
  const applied = migrate(db);
  if (applied.length) log.info('Migrations applied', { migrations: applied });

  const storage = new Storage(config.privateRoot);
  storage.cleanTemp();
  const sessions = new SessionStore(db, { ttlHours: config.sessionTtlHours });
  sessions.purgeExpired();
  const providers = createProviderRegistry(config);
  const thumbnailer = new Thumbnailer({ db, storage, ffmpeg: findFfmpeg(config.ffmpegPath), logger: log });
  const worker = new Worker({ db, storage, config, providers, logger: log });
  const deps = { db, storage, config, providers, thumbnailer, worker, logger: log, startedAt: Date.now() };

  const router = new Router();
  const serveStatic = createStatic(path.join(APP_DIR, 'public'));
  const loginIpLimiter = new RateLimiter({ windowMs: 15 * 60_000, max: config.loginIpLimit });
  const loginEmailLimiter = new RateLimiter({ windowMs: 15 * 60_000, max: 8 });
  const apiLimiter = new RateLimiter({ windowMs: 60_000, max: 1200 });
  const cookie = (value, maxAgeSec) => serializeCookie(SESSION_COOKIE, value, { maxAgeSec, secure: config.cookieSecure });

  const clientIp = (req) => (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

  // ---------- Auth ----------
  router.get('/api/health', () => ({ status: 'ok' }));
  router.post('/api/auth/login', async (req, _c, { res }) => {
    const { email, password } = await readJson(req, 16 * 1024);
    const ip = clientIp(req);
    const emailKey = String(email || '').toLowerCase().slice(0, 200);
    if (!loginIpLimiter.hit(ip) || !loginEmailLimiter.hit(emailKey)) throw tooMany();
    const user = await authenticate(db, email, password);
    if (!user) {
      audit(db, null, 'auth.login_failed', 'user', null, {});
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    loginEmailLimiter.reset(emailKey);
    const token = sessions.create(user);
    res.setHeader('Set-Cookie', cookie(token, config.sessionTtlHours * 3600));
    audit(db, { tenantId: user.tenant_id, userId: user.id }, 'auth.login', 'user', user.id);
    const s = sessions.lookup(token);
    return { user: s.user, csrfToken: s.csrfToken };
  });
  router.get('/api/auth/me', (req, c, { session }) => {
    if (!session) throw unauthorized();
    return { user: session.user, csrfToken: session.csrfToken, features: { flowAutomation: false } };
  });
  router.post('/api/auth/logout', (req, c, { res, token }) => {
    sessions.destroy(token);
    res.setHeader('Set-Cookie', cookie('', 0));
    return { ok: true };
  });
  router.post('/api/auth/password', async (req, c, { res }) => {
    const { current, next } = await readJson(req, 16 * 1024);
    await changePassword(db, c.userId, current, next);
    sessions.destroyAllForUser(c.userId);
    res.setHeader('Set-Cookie', cookie('', 0));
    audit(db, c, 'auth.password_changed', 'user', c.userId);
    return { ok: true, signedOut: true };
  });

  registerRoutes(router, deps);

  async function handle(req, res) {
    const reqId = newId().slice(0, 8);
    applySecurityHeaders(res, { secure: config.cookieSecure });
    res.setHeader('X-Request-Id', reqId);
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
      return;
    }

    try {
      const match = router.match(req.method, pathname);
      if (!match) throw notFound('Endpoint');
      if (match.methodNotAllowed) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');

      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const session = sessions.lookup(token);
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (mutating && !originAllowed(req, config.trustProxy)) throw forbidden('Cross-origin request blocked.');
      if (!PUBLIC_API.has(pathname)) {
        if (!session) throw unauthorized();
        if (mutating && req.headers['x-csrf-token'] !== session.csrfToken) throw new AppError(403, 'CSRF', 'Security token missing or expired. Please reload the page.');
        if (!apiLimiter.hit(session.tokenHash)) throw tooMany();
      }
      const c = session ? { tenantId: session.user.tenantId, userId: session.user.id, role: session.user.role } : null;
      const result = await match.route.handler(req, c, { params: match.params, url, res, session, token });
      if (res.headersSent || res.writableEnded) return;
      sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      respondError(res, err, reqId, req);
    }
  }

  function respondError(res, err, reqId, req) {
    let status = 500, code = 'INTERNAL', message = `Something went wrong. Reference: ${reqId}`, details;
    if (err instanceof AppError) ({ status, code, publicMessage: message, details } = err);
    else if (/UNIQUE constraint failed/.test(err?.message || '')) { status = 409; code = 'CONFLICT'; message = 'This action conflicts with an existing item (for example, a job for this scene is already queued).'; }
    else if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || err?.code === 'ECONNRESET') { status = 400; code = 'ABORTED'; message = 'The upload was interrupted.'; }
    if (status >= 500) log.error('Request failed', { reqId, method: req.method, path: new URL(req.url, 'http://x').pathname, ...errorFields(err) });
    else if (status === 401 || status === 403 || status === 429) log.info('Request denied', { reqId, status, code, path: new URL(req.url, 'http://x').pathname });
    if (res.headersSent) { res.destroy(); return; }
    if (req.readable && !req.readableEnded) req.resume(); // drain unread upload bodies
    sendJson(res, status, { error: { code, message, details } }, status === 413 ? { Connection: 'close' } : {});
  }

  const server = http.createServer({ requestTimeout: 10 * 60_000, headersTimeout: 30_000 }, (req, res) => {
    handle(req, res).catch((err) => respondError(res, err, 'fatal', req));
  });
  server.keepAliveTimeout = 5000;

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await worker.stop();
    await new Promise((r) => server.close(() => r()));
    server.closeAllConnections?.();
    db.close();
  }

  return { server, deps, db, worker, close, log };
}
