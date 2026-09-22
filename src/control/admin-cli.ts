import { cp, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { AccountStore, validateSchedule } from './account-store.js';
import { loadControlConfig } from './config.js';
import { pathExists, readJson, writeJsonAtomic } from './fs-utils.js';
import { OperationLog } from './operation-log.js';
import type { AccountManifest } from './types.js';

interface AuthFile { userid?: unknown; }

const help = `EchoVIP 账号目录工具

用法：
  node dist/control/admin-cli.js migrate-legacy [旧 data 目录] [账号名称]
  node dist/control/admin-cli.js adopt <incoming 中的账号目录>
`;

const copyIfPresent = async (source: string, destination: string): Promise<void> => {
  if (await pathExists(source)) await cp(source, destination, { force: false, errorOnExist: true });
};

const migrateLegacy = async (accounts: AccountStore, operations: OperationLog, sourceArg?: string, nameArg?: string): Promise<void> => {
  const source = path.resolve(sourceArg ?? './data');
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`旧数据目录不存在：${source}`);
  const auth = await readJson<AuthFile>(path.join(source, 'auth.json'));
  const userId = String(auth?.userid ?? '');
  if (userId && await accounts.findByUserId(userId)) throw new Error('该账号已经存在于 accounts 目录');
  const manifest = await accounts.create(nameArg?.trim() || '现有账号');
  const paths = accounts.paths(manifest.id);
  try {
    for (const file of ['auth.json', 'device.json', 'state.json']) {
      await copyIfPresent(path.join(source, file), path.join(paths.runtime, file));
    }
    if (userId) await accounts.setUserId(manifest.id, userId);
    await accounts.hardenPermissions(manifest.id);
    await operations.append(manifest.id, paths, {
      source: 'system', action: 'migration', status: 'success', title: '现有账号已迁移',
      message: '认证、固定设备与签到状态已复制；原单账号数据目录保持不变',
    });
    console.log(`✅ 已复制为首个账号：${paths.root}`);
    console.log(`原目录保持不变：${source}`);
  } catch (error) {
    await accounts.delete(manifest.id).catch(() => undefined);
    throw error;
  }
};

const adopt = async (accounts: AccountStore, operations: OperationLog, sourceArg?: string): Promise<void> => {
  if (!sourceArg) throw new Error('缺少 incoming 账号目录路径');
  const source = path.resolve(sourceArg);
  const manifest = await readJson<AccountManifest>(path.join(source, 'account.json'));
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.id) throw new Error('account.json 无效');
  validateSchedule(manifest.schedule);
  const destination = accounts.paths(manifest.id).root;
  if (await pathExists(destination)) throw new Error('目标账号 ID 已存在');
  const auth = await readJson<AuthFile>(path.join(source, 'runtime', 'auth.json'));
  const userId = String(auth?.userid ?? manifest.userId ?? '');
  if (userId && await accounts.findByUserId(userId)) throw new Error('服务器中已经存在相同酷狗账号');
  if (userId !== (manifest.userId ?? '')) {
    await writeJsonAtomic(path.join(source, 'account.json'), { ...manifest, userId, updatedAt: new Date().toISOString() });
  }
  await rename(source, destination);
  await accounts.hardenPermissions(manifest.id);
  await operations.append(manifest.id, accounts.paths(manifest.id), {
    source: 'system', action: 'adopt', status: 'success', title: '账号已接入服务器',
    message: '目录结构、账号标识和重复用户检查均已通过',
  });
  console.log(`✅ 账号目录已原子接入：${destination}`);
};

const run = async (): Promise<void> => {
  const config = loadControlConfig(false);
  const accounts = new AccountStore(config.accountsDir, config.timeZone);
  const operations = new OperationLog();
  await accounts.initialize();
  const [command, first, second] = process.argv.slice(2);
  if (command === 'migrate-legacy') { await migrateLegacy(accounts, operations, first, second); return; }
  if (command === 'adopt') { await adopt(accounts, operations, first); return; }
  console.log(help);
};

run().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
