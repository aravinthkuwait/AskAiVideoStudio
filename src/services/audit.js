import { redact } from '../lib/redact.js';
import { nowIso } from '../lib/ids.js';

export function audit(db, ctx, action, targetType, targetId, meta = {}) {
  db.prepare(`INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ctx?.tenantId ?? null, ctx?.userId ?? null, action, targetType ?? null, targetId ?? null,
    JSON.stringify(redact(meta)), nowIso());
}
