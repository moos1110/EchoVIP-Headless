import { ApiClient } from './api/client.js';
import { DeviceApi } from './api/device.js';
import { LoginApi } from './api/login.js';
import { VipApi } from './api/vip.js';
import { AuthManager } from './auth/auth-manager.js';
import { QrLoginService } from './auth/qr-login.js';
import { SessionValidator } from './auth/session-validator.js';
import { TokenRefreshService } from './auth/token-refresh.js';
import { DeviceManager } from './device/device-manager.js';
import { ClaimService } from './services/claim-service.js';
import { StatusService } from './services/status-service.js';

export const createAppContext = () => {
  const client = new ApiClient();
  const loginApi = new LoginApi(client);
  const vipApi = new VipApi(client);
  const device = new DeviceManager(new DeviceApi(client));
  const refresh = new TokenRefreshService(loginApi);
  const validator = new SessionValidator(vipApi);
  return {
    device,
    login: new QrLoginService(loginApi),
    refresh,
    auth: new AuthManager(validator, refresh),
    claim: new ClaimService(vipApi),
    status: new StatusService(vipApi),
  };
};

