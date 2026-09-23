# Security

## Controls implemented (Phase 1)

| Area | Control |
|---|---|
| Passwords | scrypt (N=2^15, r=8, p=1, 16-byte salt), timing-safe compare, dummy verify for unknown accounts, minimum 12 chars |
| Sessions | 256-bit random token in an `HttpOnly; SameSite=Strict` cookie (`Secure` when `COOKIE_SECURE=true`). Only the SHA-256 of the token is stored. Sliding expiry. Logout and password change revoke server-side |
| CSRF | Per-session token required in `X-CSRF-Token` on every state-changing request, plus an `Origin` same-host check |
| Authorization | Tenant and user come only from the session, and every query filters by `tenant_id`. Other tenants' objects return 404. Diagnostics and the Flow Lab are owner/admin only |
| XSS | Strict CSP (`default-src 'self'`, no inline script/style, `frame-ancestors 'none'`). The frontend never uses `innerHTML` for data. Media is served with `nosniff` and a `sandbox` CSP |
| Input validation | Declarative schema validation with length limits, JSON body limits (1–3 MB), script size limits |
| Uploads | Streamed to private temp with a hard size limit, magic-byte sniffing (PNG/JPEG/WebP only; SVG/HTML rejected), extension and MIME must agree, server-generated UUID filenames, never executed, stored outside the repo |
| Path traversal | All storage paths are built from validated UUIDs and verified to stay inside the private root. The static server rejects traversal |
| Rate limiting | Login per IP and per account, uploads per user, API per session, Flow Lab runs |
| Errors | No stack traces, paths, SQL or env values in responses. A reference id links to the private log |
| Logging | Structured JSON with automatic redaction of password/secret/token/cookie/session/api_key/authorization keys and token-like values. 5 MB rotation × 5 files, stored in `PRIVATE_STORAGE_ROOT/logs` |
| Audit | `audit_log` records security-relevant actions with redacted metadata |
| Headers | CSP, X-Frame-Options, Referrer-Policy no-referrer, COOP, CORP, Permissions-Policy, HSTS when secure |
| Google | No Google passwords are ever stored. Flow automation is hard-disabled. Future logins are interactive; CAPTCHA/MFA pauses for the user and is never bypassed; accounts are never auto-rotated |

## Public repository protections

1. Defensive `.gitignore` (created before the first commit).
2. `scripts/secret-scan.js`: content rules (private keys, cloud/API tokens, Google cookies, JWTs, credential URLs, hard-coded secrets, personal emails, personal filesystem paths) and path rules (`.env`, databases, keys, browser profiles, auth state, runtime dirs, logs, media).
3. Pre-commit hook (`npm run setup-hooks`) scans staged files, and CI scans all tracked files and runs the tests.
4. Tests use only fake credentials and synthetic data.
5. Before every push, inspect `git status`, `git diff --cached` and `git ls-files`.

## If a secret is ever committed

Do **not** just delete the file. Git history keeps it. Rotate or revoke the credential immediately, then purge history if required. Treat the secret as compromised from the moment it was pushed.

## Reporting

Please report vulnerabilities privately to the repository owner rather than opening a public issue.
