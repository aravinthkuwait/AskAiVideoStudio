// ASK AI VIDEO STUDIO's OWN backup. Writes ONLY inside
// <PRIVATE_STORAGE_ROOT>/backups/ — never touches any other backup system.
// Contents: consistent SQLite snapshot (metadata, prompts, characters, assets,
// scenes, jobs, timelines) + a tar.gz of the media directory + a manifest.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, preparePrivateRoot } from '../src/config.js';
import { openDatabase } from '../src/persistence/database.js';
import { run } from '../src/lib/tools.js';

const config = loadConfig();
preparePrivateRoot(config);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(config.privateRoot, 'backups', `backup-${stamp}`);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const db = openDatabase(config.databasePath);
const dbFile = path.join(dir, 'studio.sqlite');
db.prepare('VACUUM INTO ?').run(dbFile);
db.close();
fs.chmodSync(dbFile, 0o600);

const withMedia = !process.argv.includes('--db-only');
let mediaArchive = null;
if (withMedia) {
  const tarFile = path.join(dir, 'media.tar.gz');
  const r = await run('tar', ['-czf', tarFile, '-C', config.privateRoot, 'media'], { timeoutMs: 60 * 60 * 1000 });
  if (r.code === 0) { fs.chmodSync(tarFile, 0o600); mediaArchive = 'media.tar.gz'; }
  else console.error('Media archive failed (database snapshot is still valid).');
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ app: 'ask-ai-video-studio', createdAt: new Date().toISOString(), database: 'studio.sqlite', media: mediaArchive }, null, 2), { mode: 0o600 });
console.log(`Backup written to the private backups folder: backups/backup-${stamp}`);
