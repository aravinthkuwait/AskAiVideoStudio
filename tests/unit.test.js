import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, redactString } from '../src/lib/redact.js';
import { validate } from '../src/lib/validate.js';
import { Storage, safeDisplayName } from '../src/lib/storage.js';
import { sniffImage, checkImage, imageSize } from '../src/lib/filetype.js';
import { parseEnv } from '../src/lib/envfile.js';
import { previewScript, normaliseKey } from '../src/services/scriptImport.js';
import { previewImageMapping } from '../src/services/images.js';
import { loadConfig, preparePrivateRoot, APP_DIR, ConfigError } from '../src/config.js';
import { canTransition } from '../src/jobs/states.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { createLogger } from '../src/lib/logger.js';
import { fakePng, DEMO_SCRIPT, testEnv } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aavs-unit-'));

test('redaction removes sensitive keys and token-like values', () => {
  const r = redact({ password: 'x', nested: { apiKey: 'y', ok: 'visible' }, Authorization: 'Bearer abc', cookie: 'c' });
  assert.equal(r.password, '[REDACTED]');
  assert.equal(r.nested.apiKey, '[REDACTED]');
  assert.equal(r.nested.ok, 'visible');
  assert.equal(r.Authorization, '[REDACTED]');
  assert.equal(r.cookie, '[REDACTED]');
  const fakeBearer = 'Bearer ' + 'abcdefghij0123456789';
  assert.ok(!redactString(`header ${fakeBearer}`).includes('abcdefghij0123456789'));
  assert.ok(!redactString('url?token=' + 'secretvalue123').includes('secretvalue123'));
});

test('logger never writes sensitive values', () => {
  const dir = tmp();
  const log = createLogger({ dir, stdout: false, level: 'debug' });
  log.info('login attempt pass' + 'word=' + 'fakeHunter2x', { password: 'fakeHunter2x', access_token: 'fake-tok-123456789', job_id: 'j1' });
  const text = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.ok(!text.includes('fakeHunter2x'));
  assert.ok(!text.includes('fake-tok-123456789'));
  assert.ok(text.includes('"job_id":"j1"'));
});

test('validator enforces types, bounds and enums', () => {
  assert.deepEqual(validate({ a: ' hi ' }, { a: { type: 'string', required: true } }), { a: 'hi' });
  assert.throws(() => validate({}, { a: { type: 'string', required: true } }), /invalid/);
  assert.throws(() => validate({ n: 0 }, { n: { type: 'int', min: 1 } }));
  assert.throws(() => validate({ e: 'x' }, { e: { type: 'string', enum: ['a'] } }));
  assert.equal(validate({ s: 'a\u0000b' }, { s: { type: 'string' } }).s, 'ab');
});

test('storage resolve blocks path traversal', () => {
  const s = new Storage(tmp());
  for (const bad of ['../etc/passwd', '/etc/passwd', 'media/../../x', 'a\0b']) assert.throws(() => s.resolve(bad));
  assert.throws(() => s.mediaKey('not-an-id', null, 'x', 'png'));
  assert.equal(safeDisplayName('../../evil<script>.png'), 'evilscript.png');
  assert.equal(safeDisplayName('C:\\Users\\username\\a.png'), 'a.png');
});

test('image sniffing uses magic bytes and rejects mismatches', () => {
  const png = fakePng();
  assert.equal(sniffImage(png), 'png');
  assert.deepEqual(imageSize(png, 'png'), { width: 64, height: 36 });
  assert.equal(checkImage(png.subarray(0, 64), 'image/png', 'a.png').ok, true);
  assert.equal(checkImage(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png', 'a.png').ok, false);
  assert.equal(checkImage(png.subarray(0, 64), 'image/png', 'a.jpg').ok, false);
  assert.equal(checkImage(png.subarray(0, 64), 'image/jpeg', 'a.png').ok, false);
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('env parser handles quotes and comments', () => {
  assert.deepEqual(parseEnv('# c\nA=1\nB="two words"\nbad line\nC=\'x\''), { A: '1', B: 'two words', C: 'x' });
});

test('config refuses private root inside the source checkout and missing values', () => {
  assert.throws(() => loadConfig({ PRIVATE_STORAGE_ROOT: path.join(APP_DIR, 'private-runtime') }, { loadDotEnv: false }), ConfigError);
  assert.throws(() => loadConfig({}, { loadDotEnv: false }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PRIVATE_STORAGE_ROOT: path.join(tmp(), 'p'), APP_SECRET: 'CHANGE_ME' }, { loadDotEnv: false }), ConfigError);
  const cfg = loadConfig({ NODE_ENV: 'production', PRIVATE_STORAGE_ROOT: path.join(tmp(), 'p'), APP_SECRET: 'x'.repeat(40) }, { loadDotEnv: false });
  assert.equal(cfg.cookieSecure, true);
  assert.equal(cfg.flowAutomationEnabled, false);
});

test('private root is never adopted if it contains foreign data', () => {
  const base = tmp();
  const foreign = path.join(base, 'existing-project');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'important.txt'), 'do not touch');
  const cfg = loadConfig(testEnv(base, { PRIVATE_STORAGE_ROOT: foreign }), { loadDotEnv: false });
  assert.throws(() => preparePrivateRoot(cfg), /does not belong/);
  assert.equal(fs.readFileSync(path.join(foreign, 'important.txt'), 'utf8'), 'do not touch');
  assert.deepEqual(fs.readdirSync(foreign), ['important.txt']);
});

test('master script (text) parses, validates and preserves text', () => {
  const p = previewScript(DEMO_SCRIPT);
  assert.equal(p.format, 'text');
  assert.equal(p.scenes.length, 3);
  assert.equal(p.canImport, true);
  const [s1, s2] = p.scenes;
  assert.equal(s1.draft.scene_code, 'S001');
  assert.equal(s1.draft.dialogue, 'NOVA: We made it.\nNARRATOR: And so it began.', 'dialogue lines with NAME: stay in DIALOGUE');
  assert.equal(s2.draft.duration_sec, 8);
  assert.equal(s2.extra.MOOD, undefined, 'unknown keys are kept as text of the previous field');
  assert.ok(s2.draft.video_prompt.includes('MOOD: mysterious'));
  assert.ok(s2.warnings.some((w) => /DESCRIPTION/.test(w)));
});

test('master script detects errors: duplicate ids, bad duration, bad aspect ratio', () => {
  const p = previewScript('SCENE_ID: A\nTITLE: x\nDURATION: abc\n---\nSCENE_ID: A\nTITLE: y\nASPECT_RATIO: 7:3');
  assert.equal(p.canImport, false);
  assert.ok(p.scenes[0].errors.some((e) => /DURATION/.test(e)));
  assert.ok(p.scenes[1].errors.some((e) => /duplicated/.test(e)));
  assert.ok(p.scenes[1].errors.some((e) => /ASPECT_RATIO/.test(e)));
  assert.equal(previewScript('   ').canImport, false);
});

test('master script (JSON) supports arrays, camelCase keys and preserves unknown fields', () => {
  const p = previewScript(JSON.stringify({ scenes: [{ sceneId: 'J1', title: 'One', imagePrompt: 'p', videoPrompt: 'v', description: 'd', duration: 5, customNote: 'keep me', characters: ['A', 'B'] }] }));
  assert.equal(p.format, 'json');
  assert.equal(p.canImport, true);
  assert.equal(p.scenes[0].draft.image_prompt, 'p');
  assert.equal(p.scenes[0].draft.characters, 'A, B');
  assert.equal(p.scenes[0].extra.CUSTOM_NOTE, 'keep me');
  assert.equal(previewScript('{bad json').canImport, false);
  assert.equal(normaliseKey('Image Prompt'), 'IMAGE_PROMPT');
});

test('image mapping preview matches Scene_001 / S003 / SCENE_ID names', () => {
  const scenes = [
    { id: 'a', position: 1, scene_code: 'S001', title: 'One', image_status: 'PENDING' },
    { id: 'b', position: 2, scene_code: 'intro-shot', title: 'Two', image_status: 'APPROVED' },
    { id: 'c', position: 3, scene_code: '', title: 'Three', image_status: 'PENDING' },
  ];
  const r = previewImageMapping(scenes, ['Scene_001.png', 'scene-2.jpg', 'S003.webp', 'intro-shot.png', 'notes.txt', 'Scene_099.png']);
  const by = Object.fromEntries(r.rows.map((x) => [x.filename, x]));
  assert.equal(by['Scene_001.png'].sceneId, 'a');
  assert.equal(by['scene-2.jpg'].sceneId, 'b');
  assert.match(by['scene-2.jpg'].issue, /alternative/);
  assert.equal(by['S003.webp'].sceneId, 'c');
  assert.equal(by['intro-shot.png'].sceneId, 'b');
  assert.equal(by['notes.txt'].sceneId, null);
  assert.equal(by['Scene_099.png'].sceneId, null);
});

test('job state machine rejects invalid transitions', () => {
  assert.ok(canTransition('QUEUED', 'PREPARING'));
  assert.ok(canTransition('FAILED', 'QUEUED'));
  assert.ok(!canTransition('COMPLETED', 'QUEUED'), 'completed jobs are never re-run');
  assert.ok(!canTransition('CANCELLED', 'QUEUED'));
});

test('password hashing uses scrypt with salt', async () => {
  const a = await hashPassword('a-long-test-password');
  const b = await hashPassword('a-long-test-password');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$/);
  assert.ok(await verifyPassword('a-long-test-password', a));
  assert.ok(!(await verifyPassword('wrong-password-here', a)));
});
