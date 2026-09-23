// Stage A lab self-test. Uses ONLY a local 127.0.0.1 test server — never Google,
// never a login, never credits. Skipped when no Chromium is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, preparePrivateRoot } from '../src/config.js';
import { runSafeChecks, S } from '../src/flow-lab/lab.js';
import { findChrome } from '../src/lib/tools.js';
import { Storage } from '../src/lib/storage.js';
import { testEnv } from './helpers.js';

const chrome = findChrome(process.env.CHROME_PATH || '');

test('Stage A lab verifies browser mechanics with real evidence (no Google, no credits)', { skip: !chrome && 'no Chromium installed', timeout: 120000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aavs-lab-'));
  const config = loadConfig(testEnv(base), { loadDotEnv: false });
  preparePrivateRoot(config);
  const r = await runSafeChecks(config, { checkFlowNavigation: false, headed: false });
  const by = Object.fromEntries(r.items.map((i) => [i.key, i.status]));
  for (const k of ['browser_binary', 'browser_startup', 'page_navigation', 'download', 'timeouts', 'browser_restart', 'profile_persistence', 'storage_permissions']) {
    assert.equal(by[k], S.VERIFIED, `${k}: ${r.items.find((i) => i.key === k).detail}`);
  }
  assert.equal(by.flow_navigation, S.NOT_VERIFIED, 'Google is never contacted without explicit consent');
  assert.equal(by.image_workflow, S.MANUAL);
  assert.equal(r.creditsConsumed, false);
  assert.equal(r.productionAutomationEnabled, false);
  assert.deepEqual(fs.readdirSync(path.join(config.privateRoot, 'browser-profiles', '_lab')), [], 'temporary lab profile removed');
});

test('browser profiles use opaque ids under the tenant, never emails or traversal', () => {
  const s = new Storage(fs.mkdtempSync(path.join(os.tmpdir(), 'aavs-prof-')));
  const t = '11111111-1111-4111-8111-111111111111';
  const p = '22222222-2222-4222-8222-222222222222';
  const dir = s.browserProfileDir(t, p);
  assert.ok(dir.endsWith(path.join('browser-profiles', t, p)));
  assert.equal((fs.statSync(dir).mode & 0o777).toString(8), '700');
  for (const bad of [['user@example.com', p], [t, '../../etc'], [t, 'user@example.com']]) assert.throws(() => s.browserProfileDir(...bad));
});
