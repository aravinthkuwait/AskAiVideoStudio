// Scanner self-test. Fake secrets are assembled at runtime so that THIS file
// never contains a real-looking secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanContent, scanPath } from '../scripts/secret-scan.js';

const j = (...p) => p.join('');
const rules = (p, c) => scanContent(p, c).map((f) => f.rule);

test('detects fake credentials of many kinds', () => {
  assert.ok(rules('a.js', j('-----BEGIN ', 'RSA PRIVATE KEY-----')).includes('private-key'));
  assert.ok(rules('a.js', j('const k = "AI', 'za', 'A'.repeat(35), '"')).includes('google-api-key'));
  assert.ok(rules('a.js', j('gh', 'p_', 'a'.repeat(36))).includes('github-token'));
  assert.ok(rules('a.js', j('ya', '29.', 'b'.repeat(30))).includes('google-oauth-token'));
  assert.ok(rules('a.js', j('AK', 'IA', 'ABCDEFGHIJKLMNOP')).includes('aws-access-key'));
  assert.ok(rules('a.js', j('pass', 'word = "S3cr3tValue99"')).includes('hardcoded-secret-assignment'));
  assert.ok(rules('a.txt', j('__Secure-1P', 'SID=', 'x'.repeat(20))).includes('google-session-cookie'));
  assert.ok(rules('a.md', j('postgres://admin:', 'hunter2hunter2', '@db.internal/x')).includes('url-with-credentials'));
});

test('flags personal information but allows example data', () => {
  assert.ok(rules('a.md', j('contact: someone', '@gmail.com')).includes('personal-email'));
  assert.deepEqual(rules('a.md', 'contact: user@example.com or ops@your-domain.example'), []);
  assert.ok(rules('a.md', j('/ho', 'me/alice/secret-project/')).includes('personal-filesystem-path'));
  assert.deepEqual(rules('a.md', 'PRIVATE_STORAGE_ROOT=/private/runtime/path'), []);
  assert.deepEqual(rules('a.js', 'APP_SECRET=CHANGE_ME'), []);
  assert.deepEqual(rules('a.js', 'const password = req.body.password;'), []);
});

test('blocks private file types by path', () => {
  const r = (p) => scanPath(p).map((f) => f.rule);
  assert.ok(r('.env').includes('env-file'));
  assert.ok(r('config/.env.production').includes('env-file'));
  assert.deepEqual(r('.env.example'), []);
  assert.ok(r('data/studio.sqlite').includes('database-file'));
  assert.ok(r('browser-profiles/a/Default/Cookies').includes('browser-profile'));
  assert.ok(r('x/storage-state.json').includes('auth-state'));
  assert.ok(r('private-runtime/media/a.png').includes('private-runtime-dir'));
  assert.ok(r('exports/final.mp4').includes('media-file'));
  assert.ok(r('server.key').includes('key-or-cert'));
  assert.deepEqual(r('public/img/favicon.svg'), []);
  assert.deepEqual(r('src/app.js'), []);
});
