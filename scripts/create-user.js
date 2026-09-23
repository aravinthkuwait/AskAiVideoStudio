// Creates a tenant + owner account. The password is read interactively (or
// from the AAVS_NEW_PASSWORD env var for automation) and never logged.
// Usage: npm run create-user -- --email you@your-domain.example --name "Your Name" [--studio "Studio name"]
import readline from 'node:readline';
import { loadConfig, preparePrivateRoot } from '../src/config.js';
import { openDatabase, migrate } from '../src/persistence/database.js';
import { createTenantWithOwner } from '../src/services/users.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const email = arg('email');
if (!email) { console.error('Usage: npm run create-user -- --email you@your-domain.example [--name "Name"] [--studio "Studio"]'); process.exit(64); }

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const config = loadConfig();
preparePrivateRoot(config);
const db = openDatabase(config.databasePath);
migrate(db);
let password = process.env.AAVS_NEW_PASSWORD;
if (!password) {
  password = await askHidden('Password (min 12 chars): ');
  const again = await askHidden('Repeat password: ');
  if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
}
try {
  await createTenantWithOwner(db, { email, displayName: arg('name'), tenantName: arg('studio') || 'My Studio', password });
  console.log('Account created. You can now sign in.');
} catch (e) {
  console.error(e.publicMessage || e.message);
  process.exitCode = 1;
} finally { db.close(); }
