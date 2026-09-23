#!/usr/bin/env node
// Stage A Flow feasibility lab. No login, no credits.
// Usage: npm run flow-lab [-- --check-flow-navigation] [-- --headless]
import { loadConfig, preparePrivateRoot } from '../config.js';
import { runSafeChecks, saveReport } from './lab.js';

const config = loadConfig();
preparePrivateRoot(config);
const argv = process.argv.slice(2);
const report = await runSafeChecks(config, {
  checkFlowNavigation: argv.includes('--check-flow-navigation') || argv.includes('--check-reachability'),
  headed: argv.includes('--headless') ? false : null,
});
saveReport(config, report);
console.log('FLOW FEASIBILITY LAB — Stage A (no login, no credits)\n');
for (const i of report.items) console.log(`${i.status.padEnd(22)} ${i.label}\n${' '.repeat(23)}${i.detail}`);
console.log(`\nStage A: ${report.stageA}${report.blockingItems.length ? ` (blocking: ${report.blockingItems.join(', ')})` : ''}`);
console.log('Report saved to the private runtime (flow-lab/latest-report.json).');
process.exitCode = report.stageA === 'READY FOR MANUAL LOGIN' ? 0 : 2;
