import path from 'node:path';
import { config } from '../config.js';
import type { AuthState, DeviceIdentity, JsonObject, TaskState } from '../types.js';
import { ApiError, RiskControlError } from '../utils/errors.js';
import { dateInTimezone, nowIso } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import { stateStore } from '../storage/stores.js';
import { VipApi } from '../api/vip.js';
import { normalizeVipStatus } from './vip-status.js';
import { ProcessLock } from './process-lock.js';

const successBody = (body: JsonObject): boolean => !!body && typeof body === 'object' && Number(body.status) === 1 && Number(body.error_code ?? 0) === 0;
const alreadyMessage = (body: JsonObject): boolean => /已领取|重复|already/i.test(String(body.msg ?? body.message ?? ''));

export class ClaimService {
  constructor(private readonly api: VipApi) {}

  async claim(device: DeviceIdentity, auth: AuthState): Promise<'SUCCESS' | 'ALREADY' | 'LOCKED'> {
    const lock = new ProcessLock(path.join(config.dataDir, 'claim.lock'));
    if (!(await lock.acquire())) return 'LOCKED';
    const today = dateInTimezone(config.timezone);
    let dispatched = false;
    try {
      const local = await stateStore.read();
      if (local?.userid === auth.userid && local.lastClaimStatus === 'RISK_CONTROL') throw new RiskControlError('自动领取已暂停，请在官方客户端完成验证后重新登录');
      if (local?.userid === auth.userid && local.lastClaimDate === today && ['SUCCESS', 'ALREADY'].includes(local.lastClaimStatus ?? '')) return 'ALREADY';
      await logger.info(`开始检查 ${today} 的领取状态`);
      const month = await this.api.monthRecord({ device, auth });
      const remote = normalizeVipStatus(month.body, {}, today);
      if (remote.claimedToday) {
        await this.saveState(auth.userid, today, 'ALREADY', null);
        return 'ALREADY';
      }
      if (local?.userid === auth.userid && local.lastClaimDate === today && local.lastClaimStatus === 'UNCONFIRMED') throw new ApiError('今日领取结果尚未确认，禁止重复发送领取请求');
      await this.saveState(auth.userid, today, 'UNCONFIRMED', null);
      dispatched = true;
      const result = await this.api.claimDay({ device, auth }, today);
      if (!successBody(result.body) && !alreadyMessage(result.body)) {
        throw new ApiError(String(result.body.msg ?? 'VIP 领取失败'), result.body);
      }
      const status = alreadyMessage(result.body) ? 'ALREADY' : 'SUCCESS';
      const verification = await this.api.monthRecord({ device, auth });
      if (!normalizeVipStatus(verification.body, {}, today).claimedToday) throw new ApiError('领取响应已返回，但远程记录尚未确认；本次不记为成功');
      await this.saveState(auth.userid, today, status, null);
      await logger.success(status === 'SUCCESS' ? '今日 VIP 领取成功' : '今日 VIP 已领取');
      return status;
    } catch (error) {
      const previous = await stateStore.read();
      await this.saveState(auth.userid, today, error instanceof RiskControlError ? 'RISK_CONTROL' : dispatched || (previous?.userid === auth.userid && previous.lastClaimDate === today && previous.lastClaimStatus === 'UNCONFIRMED') ? 'UNCONFIRMED' : 'FAILED', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await lock.release();
    }
  }

  private async saveState(userid: string, date: string, status: TaskState['lastClaimStatus'], error: string | null): Promise<void> {
    await stateStore.write({ version: 1, userid, lastClaimDate: date, lastClaimStatus: status, lastClaimAt: nowIso(), lastError: error });
  }
}
