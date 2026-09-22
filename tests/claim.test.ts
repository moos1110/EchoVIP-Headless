import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaimService } from '../src/services/claim-service.js';
import { normalizeVipStatus } from '../src/services/vip-status.js';
import { hasRiskControl } from '../src/services/risk-control.js';
import { stateStore } from '../src/storage/stores.js';
import { generateDeviceIdentity } from '../src/device/device-generator.js';
import type { AuthState } from '../src/types.js';
import { ApiClient } from '../src/api/client.js';
import { RiskControlError } from '../src/utils/errors.js';

const auth: AuthState = {
  version: 1, userid: '123', token: 'token', loginMethod: 'qr',
  createdAt: '', updatedAt: '', lastValidatedAt: null, lastRefreshAt: null,
};

describe('VIP 状态与领取', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('从嵌套月度记录识别今日已领取', () => {
    expect(normalizeVipStatus({ status: 1, data: { records: [{ receive_day: '2026-09-19' }] } }, {}, '2026-09-19')).toMatchObject({ claimedToday: true, claimedDays: 1 });
  });

  it('识别酷狗概念版真实 list/day 结构且只统计本月已领取记录', () => {
    const body = {
      status: 1,
      error_code: 0,
      data: {
        month: '2026-09',
        list: [
          { day: '2026-08-29', receive_vip: 1, recharge_num: 1, vip_type: 'svip' },
          { day: '2026-09-18', receive_vip: 1, recharge_num: 1, vip_type: 'svip' },
          { day: '2026-09-19', receive_vip: 1, recharge_num: 1, vip_type: 'svip' },
          { day: '2026-09-20', receive_vip: 0, recharge_num: 0, vip_type: 'svip' },
        ],
      },
    };
    expect(normalizeVipStatus(body, {}, '2026-09-19')).toMatchObject({ claimedToday: true, claimedDays: 2 });
  });

  it('本地当天成功时不再请求远端', async () => {
    vi.spyOn(stateStore, 'read').mockResolvedValue({ version: 1, userid: auth.userid, lastClaimDate: '2026-09-19', lastClaimStatus: 'SUCCESS', lastClaimAt: '', lastError: null });
    const api = { monthRecord: vi.fn(), claimDay: vi.fn() };
    vi.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00Z'));
    const service = new ClaimService(api as never);
    await expect(service.claim(generateDeviceIdentity(), auth)).resolves.toBe('ALREADY');
    expect(api.claimDay).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('远端未领取时只调用一次领取', async () => {
    vi.spyOn(stateStore, 'read').mockResolvedValue(null);
    vi.spyOn(stateStore, 'write').mockResolvedValue();
    const api = {
      monthRecord: vi.fn().mockResolvedValueOnce({ body: { status: 1, data: { records: [] } } }).mockResolvedValue({ body: { status: 1, data: { records: [{receive_day: new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai'}).format(new Date())}] } } }),
      claimDay: vi.fn().mockResolvedValue({ body: { status: 1, error_code: 0 } }),
    };
    const service = new ClaimService(api as never);
    await expect(service.claim(generateDeviceIdentity(), auth)).resolves.toBe('SUCCESS');
    expect(api.claimDay).toHaveBeenCalledOnce();
  });

  it('真实月度记录包含今天时不发送领取请求', async () => {
    vi.spyOn(stateStore, 'read').mockResolvedValue(null);
    vi.spyOn(stateStore, 'write').mockResolvedValue();
    const api = {
      monthRecord: vi.fn().mockResolvedValue({ body: { status: 1, error_code: 0, data: { list: [{ day: '2026-09-19', receive_vip: 1 }] } } }),
      claimDay: vi.fn(),
    };
    vi.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00Z'));
    const service = new ClaimService(api as never);
    await expect(service.claim(generateDeviceIdentity(), auth)).resolves.toBe('ALREADY');
    expect(api.claimDay).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('识别 20028 和 SSA 风控', () => {
    expect(hasRiskControl({ error_code: 20028 })).toBe(true);
    expect(hasRiskControl({}, { 'ssa-code': 'challenge' })).toBe(true);
    expect(hasRiskControl({ status: 0, message: '需要进行安全验证' })).toBe(true);
    expect(hasRiskControl({ status: 1, data: { qrcode_img: 'data:image/png;base64,abcSSAxyz' } })).toBe(false);
    expect(hasRiskControl({ status: 1 })).toBe(false);
  });

  it('未知结构不解释为未领取', () => {
    expect(() => normalizeVipStatus({status: 1, data: {update_date: '2026-09-19'}}, {}, '2026-09-19')).toThrow();
  });

  it('空领取响应不能记为成功', async () => {
    vi.spyOn(stateStore, 'read').mockResolvedValue(null);
    const write = vi.spyOn(stateStore, 'write').mockResolvedValue();
    const api = {monthRecord: vi.fn().mockResolvedValue({body: {status: 1, data: {records: []}}}), claimDay: vi.fn().mockResolvedValue({body: {}})};
    await expect(new ClaimService(api as never).claim(generateDeviceIdentity(), auth)).rejects.toThrow();
    expect(write).not.toHaveBeenCalledWith(expect.objectContaining({lastClaimStatus: 'SUCCESS'}));
  });

  it('风控响应立即停止且不重试', async () => {
    const http = {
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { error_code: 20028, msg: '安全验证' },
        headers: {},
      }),
    };
    const client = new ApiClient(http as never);
    await expect(client.request({
      method: 'GET', baseURL: 'https://example.invalid', url: '/',
      context: { device: generateDeviceIdentity(), auth },
    })).rejects.toBeInstanceOf(RiskControlError);
    expect(http.request).toHaveBeenCalledOnce();
  });
});
