import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore, timeToSecond, validateSchedule } from '../src/control/account-store.js';

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-account-'));
  roots.push(root);
  return root;
};

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AccountStore', () => {
  it('创建互相隔离的账号目录并且摘要不暴露 token', async () => {
    const root = await makeRoot();
    const store = new AccountStore(root, 'Asia/Shanghai');
    const account = await store.create('测试账号');
    const paths = store.paths(account.id);
    await writeFile(path.join(paths.runtime, 'auth.json'), JSON.stringify({ userid: '123456789', token: 'secret-token' }), 'utf8');
    await store.setUserId(account.id, '123456789');
    const summary = await store.summary(account.id);
    expect(summary.loggedIn).toBe(true);
    expect(summary.maskedUserId).toBe('12*****89');
    expect(JSON.stringify(summary)).not.toContain('secret-token');
    expect(await readFile(paths.manifest, 'utf8')).not.toContain('secret-token');
  });

  it('拒绝重复 userid', async () => {
    const store = new AccountStore(await makeRoot(), 'Asia/Shanghai');
    const first = await store.create('甲');
    const second = await store.create('乙');
    await store.setUserId(first.id, '10001');
    await expect(store.setUserId(second.id, '10001')).rejects.toThrow('已存在');
  });

  it('服务器模式把时间窗修改延后到次日，本地准备模式立即保存', async () => {
    let now = new Date('2026-09-20T16:00:00.000Z');
    const store = new AccountStore(await makeRoot(), 'Asia/Shanghai', () => now);
    const account = await store.create('计划测试');
    const next = { enabled: true, start: '08:00', end: '09:00', timeZone: 'Asia/Shanghai' };
    const deferred = await store.update(account.id, { schedule: next }, true);
    expect(deferred.schedule.enabled).toBe(false);
    expect(deferred.pendingSchedule?.effectiveDate).toBe('2026-09-22');
    now = new Date('2026-09-21T16:00:01.000Z');
    expect((await store.get(account.id)).schedule.start).toBe('08:00:00');

    const immediate = await store.update(account.id, { schedule: { ...next, start: '10:00', end: '11:00' } }, false);
    expect(immediate.schedule.start).toBe('10:00:00');
    expect(immediate.pendingSchedule).toBeUndefined();
  });
});

describe('签到时间窗校验', () => {
  it('支持 24:00 作为结束时间并拒绝跨日', () => {
    expect(timeToSecond('24:00', true)).toBe(86_400);
    expect(validateSchedule({ enabled: true, start: '23:00', end: '24:00', timeZone: 'Asia/Shanghai' }).end).toBe('24:00');
    expect(() => validateSchedule({ enabled: true, start: '23:00', end: '01:00', timeZone: 'Asia/Shanghai' })).toThrow('同一天');
  });
});
