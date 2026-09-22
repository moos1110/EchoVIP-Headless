import path from 'node:path';
import { AccountStore } from './account-store.js';
import { loadControlConfig } from './config.js';
import { CoreRunner } from './core-runner.js';
import { AccountScheduler } from './scheduler.js';
import { OperationLog } from './operation-log.js';

const run = async (): Promise<void> => {
  const config = loadControlConfig(false);
  if (config.mode !== 'server') throw new Error('provisioning 模式禁止执行调度');
  const accounts = new AccountStore(config.accountsDir, config.timeZone);
  await accounts.initialize();
  const runner = new CoreRunner(config.coreEntry, path.join(config.controlDir, 'operation.lock'), config.timeZone);
  const scheduler = new AccountScheduler(accounts, runner, path.join(config.controlDir, 'scheduler.lock'), undefined, undefined, undefined, new OperationLog());
  await scheduler.tick();
};

run().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
