import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../src/auth/auth-manager.js';
import { AuthRequiredError } from '../src/utils/errors.js';
import { generateDeviceIdentity } from '../src/device/device-generator.js';
import type { AuthState } from '../src/types.js';
import { authStore } from '../src/storage/stores.js';
import { LoginApi } from '../src/api/login.js';

const auth: AuthState = {
  version: 1, userid: '12345678', token: 'secret', loginMethod: 'qr',
  createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
  lastValidatedAt: null, lastRefreshAt: null,
};

describe('AuthManager', () => {
  it('Token 有效时不刷新', async () => {
    vi.spyOn(authStore, 'read').mockResolvedValue(auth);
    const validator = { validate: vi.fn().mockResolvedValue(auth) };
    const refresher = { refresh: vi.fn() };
    const manager = new AuthManager(validator as never, refresher as never);
    await expect(manager.ensureValid(generateDeviceIdentity())).resolves.toBe(auth);
    expect(refresher.refresh).not.toHaveBeenCalled();
  });

  it('Token 失效后刷新并再次验证', async () => {
    vi.spyOn(authStore, 'read').mockResolvedValue(auth);
    const refreshed = { ...auth, token: 'new-secret' };
    const validator = { validate: vi.fn().mockRejectedValueOnce(new AuthRequiredError()).mockResolvedValueOnce(refreshed) };
    const refresher = { refresh: vi.fn().mockResolvedValue(refreshed) };
    const manager = new AuthManager(validator as never, refresher as never);
    await expect(manager.ensureValid(generateDeviceIdentity())).resolves.toEqual(refreshed);
    expect(refresher.refresh).toHaveBeenCalledOnce();
  });
});

describe('LoginApi', () => {
  it('二维码请求保留统一设备参数', async () => {
    const request = vi.fn().mockResolvedValue({
      body: { status: 1, data: { qrcode: 'temporary-key' } }, cookies: {}, headers: {}, status: 200,
    });
    const api = new LoginApi({ request } as never);
    const device = generateDeviceIdentity();
    await api.createQrKey({ device, auth: null });
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty('clearDefaultParams');
  });
});
