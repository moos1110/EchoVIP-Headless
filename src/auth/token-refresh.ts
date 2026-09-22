import type { AuthState, DeviceIdentity, JsonObject } from '../types.js';
import { AuthRequiredError, InvalidResponseError, TokenExpiredError } from '../utils/errors.js';
import { nowIso } from '../utils/date.js';
import { authStore } from '../storage/stores.js';
import { LoginApi } from '../api/login.js';

export class TokenRefreshService {
  constructor(private readonly api: LoginApi) {}

  async refresh(device: DeviceIdentity, current?: AuthState | null): Promise<AuthState> {
    const auth = current ?? await authStore.read();
    if (!auth) throw new AuthRequiredError();
    let response;
    try { response = await this.api.refresh({ device, auth }); }
    catch (error) {
      throw error;
    }
    const body = response.body as JsonObject;
    const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
    if (Number(body.status) !== 1) throw new TokenExpiredError(String(body.msg ?? 'Token 刷新被拒绝'));
    const token = String(data.token ?? response.cookies.token ?? auth.token);
    const userid = String(data.userid ?? response.cookies.userid ?? auth.userid);
    if (!token || !userid || userid === '0') throw new InvalidResponseError('Token 刷新响应缺少 token 或 userid', body);
    const timestamp = nowIso();
    const updated: AuthState = {
      ...auth, token, userid, updatedAt: timestamp, lastRefreshAt: timestamp,
      ...(data.t1 || response.cookies.t1 ? { t1: String(data.t1 ?? response.cookies.t1) } : {}),
      ...(data.vip_type !== undefined ? { vipType: String(data.vip_type) } : {}),
      ...(data.vip_token !== undefined ? { vipToken: String(data.vip_token) } : {}),
    };
    await authStore.write(updated);
    return updated;
  }
}
