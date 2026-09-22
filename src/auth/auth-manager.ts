import type { AuthState, DeviceIdentity } from '../types.js';
import { AuthRequiredError } from '../utils/errors.js';
import { authStore } from '../storage/stores.js';
import { SessionValidator } from './session-validator.js';
import { TokenRefreshService } from './token-refresh.js';

export class AuthManager {
  constructor(
    private readonly validator: SessionValidator,
    private readonly refresher: TokenRefreshService,
  ) {}

  async ensureValid(device: DeviceIdentity): Promise<AuthState> {
    const auth = await authStore.read();
    if (!auth) throw new AuthRequiredError();
    try { return await this.validator.validate(device, auth); }
    catch (error) {
      if (!(error instanceof AuthRequiredError)) throw error;
      const refreshed = await this.refresher.refresh(device, auth);
      return this.validator.validate(device, refreshed);
    }
  }
}

