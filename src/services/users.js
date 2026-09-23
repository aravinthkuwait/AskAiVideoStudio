import { hashPassword, passwordProblems, verifyPassword, dummyVerify } from '../auth/passwords.js';
import { newId, nowIso } from '../lib/ids.js';
import { transaction } from '../persistence/database.js';
import { badRequest, conflict } from '../lib/errors.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function createTenantWithOwner(db, { tenantName, email, displayName, password, role = 'owner', plan = 'INTERNAL' }) {
  const problem = passwordProblems(password);
  if (problem) throw badRequest(problem);
  if (!EMAIL_RE.test(email || '')) throw badRequest('A valid email address is required.');
  const hash = await hashPassword(password);
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email)) throw conflict('An account with this email already exists.');
    const tenantId = newId();
    const userId = newId();
    const now = nowIso();
    db.prepare('INSERT INTO tenants (id, name, plan, created_at) VALUES (?, ?, ?, ?)').run(tenantId, tenantName || 'Studio', plan, now);
    db.prepare('INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, tenantId, email.trim(), displayName || email.split('@')[0], hash, role, now);
    return { tenantId, userId };
  });
}

export async function authenticate(db, email, password) {
  const user = typeof email === 'string'
    ? db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND disabled_at IS NULL').get(email.trim())
    : null;
  if (!user || typeof password !== 'string' || password.length > 256) {
    await dummyVerify(String(password ?? '').slice(0, 256));
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}

export async function changePassword(db, userId, current, next) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !(await verifyPassword(current ?? '', user.password_hash))) throw badRequest('Current password is incorrect.');
  const problem = passwordProblems(next);
  if (problem) throw badRequest(problem);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), userId);
}
