// Standalone worker process (WORKER_MODE=external). Shares the SQLite database
// (WAL mode) with the web process. Run exactly ONE worker per database.
import path from 'node:path';
import { loadConfig, preparePrivateRoot } from '../config.js';
import { openDatabase, migrate } from '../persistence/database.js';
import { createLogger } from '../lib/logger.js';
import { Storage } from '../lib/storage.js';
import { createProviderRegistry } from '../providers/registry.js';
import { Worker } from './worker.js';

const config = loadConfig();
preparePrivateRoot(config);
const logger = createLogger({ dir: path.join(config.privateRoot, 'logs'), file: 'worker.log', level: config.logLevel, stdout: config.logToStdout });
const db = openDatabase(config.databasePath);
migrate(db);
const worker = new Worker({ db, storage: new Storage(config.privateRoot), config, providers: createProviderRegistry(config), logger });
worker.start();
const keepAlive = setInterval(() => {}, 60_000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { clearInterval(keepAlive); await worker.stop(); db.close(); process.exit(0); });
