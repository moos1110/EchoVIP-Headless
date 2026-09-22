import { createAppContext } from './app-context.js';
import { authStore } from './storage/stores.js';
import { isEchoVipError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { loginCommand } from './cli/login-command.js';
import { statusCommand } from './cli/status-command.js';
import { claimCommand } from './cli/claim-command.js';
import { refreshCommand } from './cli/refresh-command.js';
import { logoutCommand } from './cli/logout-command.js';

const help = `EchoVIP Headless

用法：echovip <command>

命令：
  login [--force]  二维码登录
  status           查询账号、设备及 VIP 状态
  claim            领取服务器当天 VIP
  refresh          刷新 Token
  logout           清除登录态，保留设备身份
  device:reset     重置设备身份（谨慎使用）
  --help           显示帮助
`;

const run = async (): Promise<void> => {
  const command = process.argv[2] ?? '--help';
  const app = createAppContext();
  if (command === '--help' || command === '-h' || command === 'help') { console.log(help); return; }
  if (command === 'login') { await loginCommand(app, process.argv.includes('--force')); return; }
  if (command === 'status') { await statusCommand(app); return; }
  if (command === 'claim') { await claimCommand(app); return; }
  if (command === 'refresh') { await refreshCommand(app); return; }
  if (command === 'logout') { await logoutCommand(); return; }
  if (command === 'device:reset') {
    if (await authStore.read()) throw new Error('存在登录态时禁止重置设备；请先 logout');
    await app.device.reset();
    console.log('⚠️ 设备身份已重置，下次运行会重新注册 dfid');
    return;
  }
  console.error(`未知命令：${command}\n\n${help}`);
  process.exitCode = 2;
};

run().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  await logger.error(message).catch(() => undefined);
  console.error(`❌ ${message}`);
  process.exitCode = isEchoVipError(error) ? error.exitCode : 1;
});

