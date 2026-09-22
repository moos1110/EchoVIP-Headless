import type { createAppContext } from '../app-context.js';
import { authStore, stateStore } from '../storage/stores.js';
import { maskSecret, maskUserId } from '../utils/mask.js';
import { localDateTime } from '../utils/date.js';
import { config } from '../config.js';

type Context = ReturnType<typeof createAppContext>;

export const statusCommand = async (app: Context): Promise<void> => {
  const device = await app.device.ensure();
  const storedAuth = await authStore.read();
  const state = await stateStore.read();
  console.log('\nEchoVIP Headless\n');
  if (!storedAuth) {
    console.log('账号\n  登录状态：❌ 未登录');
  } else {
    const auth = await app.auth.ensureValid(device);
    const vip = await app.status.fetch(device, auth);
    console.log(`账号\n  登录状态：✅ 已登录\n  用户 ID：${maskUserId(auth.userid)}`);
    console.log(`\nVIP\n  今日：${vip.claimedToday ? '✅ 已领取' : '未领取'}\n  本月：${vip.claimedDays} 天\n  当前有效：${vip.active === null ? '未知' : vip.active ? '✅ 是' : '否'}`);
    console.log(`\nToken\n  状态：✅ 有效\n  上次刷新：${auth.lastRefreshAt ? localDateTime(config.timezone, new Date(auth.lastRefreshAt)) : '尚未刷新'}`);
  }
  console.log(`\n设备\n  guid：${maskSecret(device.guid)}\n  mid：${maskSecret(device.mid)}\n  dfid：${maskSecret(device.dfid)}`);
  console.log(`\n最后任务\n  时间：${state?.lastClaimAt ? localDateTime(config.timezone, new Date(state.lastClaimAt)) : '无'}\n  结果：${state?.lastClaimStatus ?? '无'}\n`);
};

