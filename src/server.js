// Entry point. Starts ONLY this application on its own port; if the port is
// taken it exits instead of interfering with any other service.
import { loadConfig, ConfigError } from './config.js';
import { createApp } from './app.js';
import { errorFields } from './lib/logger.js';

let config;
try { config = loadConfig(); } catch (e) {
  if (e instanceof ConfigError) { console.error(`Configuration error: ${e.message}`); process.exit(78); }
  throw e;
}

let app;
try { app = createApp(config); } catch (e) {
  if (e instanceof ConfigError) { console.error(`Configuration error: ${e.message}`); process.exit(78); }
  throw e;
}
const { server, worker, log, close } = app;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${config.port} is already in use by another program. Choose a different PORT; nothing else was changed.`);
    process.exit(98);
  }
  log.error('Server error', errorFields(err));
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  log.info('ASK AI VIDEO STUDIO started', { host: config.host, port: config.port, workerMode: config.workerMode, env: config.nodeEnv });
  if (config.workerMode === 'embedded') worker.start();
});

let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down', { signal: sig });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await close();
    process.exit(0);
  });
}
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', errorFields(err)));
