#!/usr/bin/env node
// Usage: npm run flow-lab [-- --check-reachability]
import { loadConfig, preparePrivateRoot } from '../config.js';
import { runSafeChecks, saveReport } from './lab.js';

const config = loadConfig();
preparePrivateRoot(config);
const report = await runSafeChecks(config, { checkReachability: process.argv.includes('--check-reachability') });
saveReport(config, report);
console.log('FLOW FEASIBILITY LAB — safe checks (no login, no credits)\n');
for (const i of report.items) console.log(`${i.status.padEnd(22)} ${i.label}\n${' '.repeat(23)}${i.detail}`);
console.log('\nReport saved to the private runtime (flow-lab/latest-report.json).');
