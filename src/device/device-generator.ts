import { randomBytes, randomUUID } from 'node:crypto';
import { md5 } from '../utils/crypto.js';
import type { DeviceIdentity } from '../types.js';
import { nowIso } from '../utils/date.js';

export const calculateMid = (guid: string): string => BigInt(`0x${md5(guid)}`).toString(10);

export const generateDeviceIdentity = (): DeviceIdentity => {
  // EchoMusic 会先生成 UUID，再取 MD5 作为真正持久化和发送的 GUID。
  const guid = md5(randomUUID());
  return {
    version: 1,
    guid,
    mid: calculateMid(guid),
    dfid: '',
    dev: 'EchoMusic',
    mac: '02:00:00:00:00:00',
    webgl: BigInt(`0x${randomBytes(8).toString('hex')}`).toString(10),
    platform: 'concept',
    createdAt: nowIso(),
  };
};

export const needsEchoIdentityMigration = (device: DeviceIdentity): boolean =>
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(device.guid) || device.dev !== 'EchoMusic';

export const migrateEchoIdentity = (device: DeviceIdentity): DeviceIdentity => {
  const guid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(device.guid) ? md5(device.guid) : device.guid;
  return { ...device, guid, mid: calculateMid(guid), dev: 'EchoMusic', dfid: '' };
};
