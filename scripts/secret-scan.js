#!/usr/bin/env node
// Lightweight secret / private-data scanner (no dependencies).
//   node scripts/secret-scan.js --staged    # files staged for commit (pre-commit hook)
//   node scripts/secret-scan.js --tracked   # every tracked file (CI / before push)
// Exit code 1 = SECURITY BLOCK. Findings never print the secret value itself.
// Patterns are assembled from fragments so this file does not match itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const j = (...p) => p.join('');
export const CONTENT_RULES = [
  { id: 'private-key', re: new RegExp(j('-----BEGIN ', '(?:[A-Z]+ )?', 'PRIVATE KEY', '-----')) },
  { id: 'aws-access-key', re: new RegExp(j('\\b(?:AK', 'IA|AS', 'IA)[0-9A-Z]{16}\\b')) },
  { id: 'google-api-key', re: new RegExp(j('\\bAI', 'za[0-9A-Za-z_-]{35}\\b')) },
  { id: 'google-oauth-token', re: new RegExp(j('\\bya', '29\\.[0-9A-Za-z_-]{20,}')) },
  { id: 'google-oauth-client-secret', re: new RegExp(j('\\bGOC', 'SPX-[0-9A-Za-z_-]{20,}')) },
  { id: 'github-token', re: new RegExp(j('\\b(?:gh', '[pousr]_[0-9A-Za-z]{30,}|github', '_pat_[0-9A-Za-z_]{30,})')) },
  { id: 'slack-token', re: new RegExp(j('\\bxo', 'x[abprs]-[0-9A-Za-z-]{10,}')) },
  { id: 'openai-style-key', re: new RegExp(j('\\bs', 'k-(?:proj-|live_|test_)?[0-9A-Za-z_-]{24,}')) },
  { id: 'stripe-key', re: new RegExp(j('\\b(?:sk|rk)_', '(?:live|test)_[0-9A-Za-z]{16,}')) },
  { id: 'jwt', re: new RegExp(j('\\bey', 'J[0-9A-Za-z_-]{10,}\\.ey', 'J[0-9A-Za-z_-]{10,}\\.[0-9A-Za-z_-]{10,}')) },
  { id: 'google-session-cookie', re: new RegExp(j('\\b(?:__Secure-[0-9]P', 'SID|SAPIS', 'ID|__Secure-1PSIDTS|HS', 'ID)\\s*[=:\\t]\\s*[A-Za-z0-9._-]{10,}')) },
  { id: 'netscape-cookie-file', re: new RegExp(j('# Netscape ', 'HTTP Cookie File')) },
  { id: 'url-with-credentials', re: new RegExp(j('[a-z][a-z0-9+.-]*://[^\\s:/@]+:[^\\s:/@]{6,}', '@[^\\s/]+'), 'i') },
  {
    id: 'hardcoded-secret-assignment',
    re: new RegExp(j('\\b(?:pass', 'word|passwd|secret|api_?key|access_?token|refresh_?token|client_?secret|app_secret)\\b', '\\s*[=:]\\s*["\']?([^\\s"\'`,;)]{8,})'), 'i'),
    // Allowed: obvious placeholders/fakes, and values that are code references (e.g. form.password.value).
    allow: (m) => /[=:]\s*["']?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(m) || /CHANGE_ME|example|placeholder|dummy|fake|test|changeme|your[-_]|<[^>]+>|\$\{|process\.env|config\.|\bdata\.|\bbody\.|\binput\.|req\.|\[REDACTED|\*\*\*|xxxx|redacted|password_hash|development-only/i.test(m),
  },
  {
    id: 'personal-email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    allow: (m) => /@(?:example\.(?:com|org|net)|[a-z0-9.-]+\.example|[a-z0-9.-]+\.test|[a-z0-9.-]+\.invalid|localhost)\b/i.test(m)
      || new RegExp(j('^noreply@', 'anthropic\\.com$')).test(m) || /@[0-9]+\.[0-9]+/.test(m),
  },
  {
    id: 'personal-filesystem-path',
    re: new RegExp(j('(?:/ho', 'me/[a-z][a-z0-9_-]{1,30}/|/Us', 'ers/[A-Za-z][A-Za-z0-9._-]{1,30}/|[A-Z]:\\\\\\\\?Us', 'ers\\\\\\\\?[A-Za-z][A-Za-z0-9._-]{1,30})')),
    allow: (m) => /\/home\/(?:user|username|youruser|app|node)\/|\/Users\/(?:you|username|name)\/|Users\\+(?:you|username|name)/.test(m),
  },
];

// Paths that must never be tracked, regardless of content.
export const PATH_RULES = [
  { id: 'env-file', re: /(^|\/)\.env(\..+)?$/, allow: (p) => /(^|\/)\.env\.example$/.test(p) },
  { id: 'database-file', re: /\.(sqlite3?|db|db-wal|db-shm|dump)$/i },
  { id: 'key-or-cert', re: /\.(pem|key|p12|pfx|jks|keystore)$/i },
  { id: 'ssh-key', re: /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/ },
  { id: 'browser-profile', re: /(^|\/)(Cookies|Login Data|Local State|Web Data|Preferences|Secure Preferences|History)$|(^|\/)(browser-profiles|chrome-profile|chromium-profile|google-sessions|user-data-dir)\// },
  { id: 'auth-state', re: /(storage-state|auth-state|cookies)[^/]*\.(json|txt)$/i },
  { id: 'private-runtime-dir', re: /(^|\/)(private-runtime|\.private-runtime|runtime|backups|logs|uploads|exports|generated[^/]*|temp|tmp)\// },
  { id: 'log-file', re: /\.log(\.\d+)?$/i },
  {
    id: 'media-file', re: /\.(png|jpe?g|webp|gif|mp4|mov|webm|mkv|wav|mp3|m4a|aac|flac|ogg)$/i,
    allow: (p) => /^public\/img\//.test(p), // only reviewed, synthetic UI assets
  },
];

const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXT = /\.(js|mjs|cjs|ts|json|md|txt|html|css|sql|yml|yaml|sh|example|gitignore|svg|webmanifest|toml|ini|cfg)$|(^|\/)(pre-commit|Dockerfile|LICENSE|README)$/i;

export function scanPath(p) {
  return PATH_RULES.filter((r) => r.re.test(p) && !(r.allow && r.allow(p))).map((r) => ({ file: p, rule: r.id, line: null }));
}

export function scanContent(p, content) {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 5000) return;
    for (const r of CONTENT_RULES) {
      const g = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g');
      for (const m of line.matchAll(g)) {
        if (r.allow && r.allow(m[0])) continue;
        findings.push({ file: p, rule: r.id, line: i + 1 });
        break;
      }
    }
  });
  return findings;
}

function git(args) { return execFileSync('git', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }); }

function listFiles(mode) {
  const out = mode === 'staged'
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z']);
  return out.toString('utf8').split('\0').filter(Boolean);
}

function readFile(mode, p) {
  if (mode === 'staged') return git(['show', `:${p}`]);
  return fs.readFileSync(p);
}

export function scanRepo(mode) {
  const findings = [];
  const files = listFiles(mode);
  for (const p of files) {
    findings.push(...scanPath(p));
    let buf;
    try { buf = readFile(mode, p); } catch { continue; }
    if (buf.length > MAX_FILE_BYTES) { findings.push({ file: p, rule: 'large-file', line: null }); continue; }
    if (!TEXT_EXT.test(p) && buf.includes(0)) continue; // binary file already judged by path rules
    findings.push(...scanContent(p, buf.toString('utf8')));
  }
  return { files, findings };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv.includes('--staged') ? 'staged' : 'tracked';
  const { files, findings } = scanRepo(mode);
  if (findings.length) {
    console.error('\nSECURITY BLOCK — POSSIBLE PRIVATE DATA\n');
    for (const f of findings) {
      console.error(`File: ${f.file}${f.line ? `:${f.line}` : ''}\nReason: ${f.rule}\nRecommended action: remove it from the commit (git restore --staged <file>), move private data to PRIVATE_STORAGE_ROOT, or replace with fake/example values.\n`);
    }
    console.error(`${findings.length} finding(s) in ${files.length} ${mode} file(s). Values are intentionally not printed.`);
    process.exit(1);
  }
  console.log(`Secret scan passed: ${files.length} ${mode} file(s), 0 findings.`);
}
