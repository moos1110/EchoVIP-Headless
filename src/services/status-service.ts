import { config } from '../config.js';
import type { AuthState, DeviceIdentity } from '../types.js';
import { dateInTimezone } from '../utils/date.js';
import { VipApi } from '../api/vip.js';
import { normalizeVipStatus, type NormalizedVipStatus } from './vip-status.js';

export class StatusService {
  constructor(private readonly api: VipApi) {}

  async fetch(device: DeviceIdentity, auth: AuthState): Promise<NormalizedVipStatus> {
    const context = { device, auth };
    const [month, union] = await Promise.all([
      this.api.monthRecord(context),
      this.api.unionStatus(context),
    ]);
    return normalizeVipStatus(month.body, union.body, dateInTimezone(config.timezone));
  }
}

