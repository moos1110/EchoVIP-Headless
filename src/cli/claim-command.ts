import type { createAppContext } from '../app-context.js';
import { authStore, stateStore } from '../storage/stores.js';
import { AuthRequiredError, RiskControlError } from '../utils/errors.js';
import { dateInTimezone } from '../utils/date.js';
import { config } from '../config.js';

type Context = ReturnType<typeof createAppContext>;

export const claimCommand = async (app: Context): Promise<void> => {
  const stored = await authStore.read();
  if (!stored) throw new AuthRequiredError();
  const state = await stateStore.read();
  if (state?.userid === stored.userid) {
    if (state.lastClaimStatus === 'RISK_CONTROL') throw new RiskControlError('自动领取已暂停，请完成官方验证后执行 login --force');
    if (state.lastClaimDate === dateInTimezone(config.timezone) && ['SUCCESS', 'ALREADY'].includes(state.lastClaimStatus ?? '')) {
      console.log('✅ 今日 VIP 已领取，无需重复操作');
      return;
    }
  }
  const device = await app.device.ensure();
  const auth = await app.auth.ensureValid(device);
  const result = await app.claim.claim(device, auth);
  if (result === 'LOCKED') console.log('✅ 另一个领取任务正在执行，本次不重复请求');
  else if (result === 'ALREADY') console.log('✅ 今日 VIP 已领取，无需重复操作');
  else console.log('✅ 今日 VIP 领取成功');
};
