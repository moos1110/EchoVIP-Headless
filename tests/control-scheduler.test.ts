import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountStore } from '../src/control/account-store.js';
import type { CoreRunner } from '../src/control/core-runner.js';
import { readJson } from '../src/control/fs-utils.js';
import { AccountScheduler } from '../src/control/scheduler.js';
import { OperationLog } from '../src/control/operation-log.js';
import type { DailyScheduleState } from '../src/control/types.js';

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-scheduler-'));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AccountScheduler', () => {
  it('在默认窗口内生成秒级时间、等待到点并且一天只执行一次', async () => {
    const root = await makeRoot();
    let now = new Date('2026-09-20T16:09:00.000Z');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai', () => now);
    const account = await store.create('午夜账号', { enabled: true, start: '00:00:00', end: '00:10:00', timeZone: 'Asia/Shanghai' });
    await writeFile(path.join(store.paths(account.id).runtime, 'auth.json'), JSON.stringify({ userid: '12345' }), 'utf8');
    await store.setUserId(account.id, '12345');
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const runner = { run } as unknown as CoreRunner;
    const wait = vi.fn(async (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); });
    const operationLog = new OperationLog(() => now);
    const scheduler = new AccountScheduler(store, runner, path.join(root, 'scheduler.lock'), () => now, () => 599, wait, operationLog);
    await scheduler.tick();
    await scheduler.tick();
    const plan = await readJson<DailyScheduleState>(store.paths(account.id).scheduler);
    expect(plan?.scheduledSecond).toBe(599);
    expect(wait).toHaveBeenCalledWith(59_000);
    expect(run).toHaveBeenCalledTimes(1);
    const operations = await operationLog.list(store.paths(account.id));
    expect(operations.some((item) => item.title === '已生成今日自动签到计划' && item.source === 'automatic')).toBe(true);
    expect(operations.some((item) => item.title === '自动签到完成' && item.exitCode === 0)).toBe(true);
  });

  it('服务器错过时间窗后在当天恢复时立即补执行', async () => {
    const root = await makeRoot();
    const now = new Date('2026-09-21T04:00:00.000Z');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai', () => now);
    const account = await store.create('补签账号', { enabled: true, start: '00:00', end: '00:10', timeZone: 'Asia/Shanghai' });
    await writeFile(path.join(store.paths(account.id).runtime, 'auth.json'), JSON.stringify({ userid: '67890' }), 'utf8');
    await store.setUserId(account.id, '67890');
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const scheduler = new AccountScheduler(store, { run } as unknown as CoreRunner, path.join(root, 'scheduler.lock'), () => now, () => 123, vi.fn());
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('手动签到已成功时不再启动核心领取', async () => {
    const root = await makeRoot();
    const now = new Date('2026-09-20T16:05:00.000Z');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai', () => now);
    const account = await store.create('已签账号', { enabled: true, start: '00:00', end: '00:10', timeZone: 'Asia/Shanghai' });
    const paths = store.paths(account.id);
    await writeFile(path.join(paths.runtime, 'auth.json'), JSON.stringify({ userid: '77889' }), 'utf8');
    await writeFile(path.join(paths.runtime, 'state.json'), JSON.stringify({ lastClaimDate: '2026-09-21', lastClaimStatus: 'SUCCESS' }), 'utf8');
    const run = vi.fn();
    const scheduler = new AccountScheduler(store, { run } as unknown as CoreRunner, path.join(root, 'scheduler.lock'), () => now, () => 10, vi.fn());
    await scheduler.tick();
    expect(run).not.toHaveBeenCalled();
    expect((await readJson<DailyScheduleState>(paths.scheduler))?.result).toBe('ALREADY_MANUAL');
  });
});
