import type { AuthState, DeviceIdentity, JsonObject } from '../types.js';
import { ApiError, AuthRequiredError } from '../utils/errors.js';
import { authStore } from '../storage/stores.js';
import { nowIso } from '../utils/date.js';
import { VipApi } from '../api/vip.js';

const authFailure = (body: JsonObject): boolean => {
  const code = Number(body.error_code ?? body.errcode ?? body.code ?? 0);
  const message = String(body.msg ?? body.message ?? '').toLowerCase();
  return [1001, 1002, 20001, 20002].includes(code) || /token|登录|login|auth/.test(message);
};

export class SessionValidator {
  constructor(private readonly api: VipApi) {}

  async validate(device: DeviceIdentity, auth?: AuthState | null): Promise<AuthState> {
    const current = auth ?? await authStore.read();
    if (!current) throw new AuthRequiredError();
    const response = await this.api.monthRecord({ device, auth: current });
    const body = response.body;
    if (authFailure(body)) throw new AuthRequiredError(String(body.msg ?? '登录态已失效'));
    if (!body || typeof body !== 'object' || Number(body.status) !== 1 || Number(body.error_code ?? 0) !== 0) {
      throw new ApiError(String(body.msg ?? '登录态验证失败'), body);
    }
    const updated = { ...current, lastValidatedAt: nowIso(), updatedAt: nowIso() };
    await authStore.write(updated);
    return updated;
  }
}
