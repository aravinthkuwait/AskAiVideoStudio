// Opaque session tokens. The cookie holds a random token; the database holds
// only its SHA-256 hash, so a leaked database cannot be replayed as cookies.
import { randomToken, sha256, nowIso } from '../lib/ids.js';

export const SESSION_COOKIE = 'aavs_sid';

export class SessionStore {
  constructor(db, { ttlHours }) {
    this.db = db;
    this.ttlMs = ttlHours * 3600 * 1000;
  }

  create(user) {
    const token = randomToken(32);
    const now = new Date();
    this.db.prepare(`INSERT INTO sessions (token_hash, user_id, tenant_id, csrf_token, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sha256(token), user.id, user.tenant_id, randomToken(24), now.toISOString(), now.toISOString(),
      new Date(now.getTime() + this.ttlMs).toISOString());
    return token;
  }

  /** Returns { session, user } or null. Slides expiry at most once per minute. */
  lookup(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const row = this.db.prepare(`SELECT s.token_hash, s.csrf_token, s.expires_at, s.last_seen_at,
        u.id AS user_id, u.tenant_id, u.email, u.display_name, u.role, u.disabled_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
    if (!row) return null;
    const now = Date.now();
    if (row.disabled_at || Date.parse(row.expires_at) <= now) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
        .run(nowIso(), new Date(now + this.ttlMs).toISOString(), row.token_hash);
    }
    return {
      tokenHash: row.token_hash,
      csrfToken: row.csrf_token,
      user: { id: row.user_id, tenantId: row.tenant_id, email: row.email, displayName: row.display_name, role: row.role },
    };
  }

  destroy(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token)); }
  destroyAllForUser(userId) { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
  purgeExpired() { return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes; }
}
