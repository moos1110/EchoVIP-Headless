import type { DeviceIdentity } from '../types.js';
import { logger } from '../utils/logger.js';
import { authStore, deviceStore } from '../storage/stores.js';
import { DeviceApi } from '../api/device.js';
import { generateDeviceIdentity, migrateEchoIdentity, needsEchoIdentityMigration } from './device-generator.js';

export class DeviceManager {
  constructor(private readonly api: DeviceApi) {}

  async ensure(): Promise<DeviceIdentity> {
    let device = await deviceStore.read();
    if (!device) {
      device = generateDeviceIdentity();
      await deviceStore.write(device);
      await logger.info('已生成并持久化设备身份');
    }
    if (needsEchoIdentityMigration(device) && !(await authStore.read())) {
      device = migrateEchoIdentity(device);
      await deviceStore.write(device);
      await logger.info('已将未登录设备身份迁移为 EchoMusic 概念版格式');
    }
    if (!device.dfid) {
      await logger.info('正在注册设备 dfid');
      const dfid = await this.api.register(device);
      device = { ...device, dfid };
      await deviceStore.write(device);
      await logger.success('设备 dfid 注册成功');
    }
    return device;
  }

  async reset(): Promise<DeviceIdentity> {
    const device = generateDeviceIdentity();
    await deviceStore.write(device);
    return device;
  }
}
