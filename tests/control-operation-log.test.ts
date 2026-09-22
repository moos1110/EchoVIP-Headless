import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../src/control/account-store.js';
import { OperationLog } from '../src/control/operation-log.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('OperationLog', () => {
  it('按新到旧返回结构化操作，并在写入和读取时脱敏', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-operation-log-'));
    roots.push(root);
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai');
    const account = await store.create('日志账号');
    let now = new Date('2026-09-21T00:00:00.000Z');
    const log = new OperationLog(() => now);
    await log.append(account.id, store.paths(account.id), {
      source: 'manual', action: 'status', status: 'success', title: '状态刷新完成', message: 'token=very-secret',
    });
    now = new Date('2026-09-21T00:01:00.000Z');
    await log.append(account.id, store.paths(account.id), {
      source: 'automatic', action: 'claim', status: 'success', title: '自动签到完成', message: '领取成功', exitCode: 0,
    });
    const records = await log.list(store.paths(account.id));
    expect(records.map((item) => item.source)).toEqual(['automatic', 'manual']);
    expect(records[0]?.exitCode).toBe(0);
    expect(records[1]?.message).not.toContain('very-secret');
  });
});
