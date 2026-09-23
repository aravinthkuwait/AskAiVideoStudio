import { loadConfig, preparePrivateRoot } from '../src/config.js';
import { openDatabase, migrate } from '../src/persistence/database.js';

const config = loadConfig();
preparePrivateRoot(config);
const db = openDatabase(config.databasePath);
const applied = migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
db.close();
