import { describe, expect, it } from 'vitest';
import { calculateMid, generateDeviceIdentity, migrateEchoIdentity, needsEchoIdentityMigration } from '../src/device/device-generator.js';

describe('设备身份', () => {
  it('MID 是 GUID 的 MD5 十进制形式', () => {
    expect(calculateMid('550e8400-e29b-41d4-a716-446655440000')).toMatch(/^\d+$/);
    expect(calculateMid('550e8400-e29b-41d4-a716-446655440000')).toBe(calculateMid('550e8400-e29b-41d4-a716-446655440000'));
  });

  it('重置后生成不同设备且字段完整', () => {
    const first = generateDeviceIdentity();
    const second = generateDeviceIdentity();
    expect(first.guid).not.toBe(second.guid);
    expect(first.mid).not.toBe(second.mid);
    expect(first.guid).toMatch(/^[0-9a-f]{32}$/);
    expect(first.dev).toBe('EchoMusic');
    expect(first.platform).toBe('concept');
  });

  it('迁移旧版随机设备身份并重新计算 MID', () => {
    const legacy = { ...generateDeviceIdentity(), guid: '550e8400-e29b-41d4-a716-446655440000', dev: '0123456789ABCDEF0123456789ABCDEF', dfid: 'old-dfid' };
    expect(needsEchoIdentityMigration(legacy)).toBe(true);
    const migrated = migrateEchoIdentity(legacy);
    expect(migrated.guid).toMatch(/^[0-9a-f]{32}$/);
    expect(migrated.mid).toBe(calculateMid(migrated.guid));
    expect(migrated.dev).toBe('EchoMusic');
    expect(migrated.dfid).toBe('');
  });
});
