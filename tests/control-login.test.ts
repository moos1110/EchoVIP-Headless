import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountStore } from '../src/control/account-store.js';
import { LoginManager } from '../src/control/login-manager.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('LoginManager', () => {
  it('通过独立目录接收二维码和认证文件，并在成功后清理二维码', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-login-'));
    roots.push(root);
    const fakeCore = path.join(root, 'fake-login.mjs');
    await writeFile(fakeCore, `
      import { writeFile, rm } from 'node:fs/promises';
      import path from 'node:path';
      const directory = process.env.DATA_DIR;
      await writeFile(path.join(directory, 'login-qr.png'), Buffer.from('png'));
      console.log('等待扫码...');
      await new Promise((resolve) => setTimeout(resolve, 120));
      console.log('✅ 已扫码，等待手机确认...');
      await writeFile(path.join(directory, 'auth.json'), JSON.stringify({ userid: '246810', token: 'secret' }));
      await rm(path.join(directory, 'login-qr.png'), { force: true });
    `, 'utf8');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai');
    const account = await store.create('扫码账号');
    const manager = new LoginManager(store, fakeCore, 'Asia/Shanghai');
    await manager.start(account.id);
    await vi.waitFor(async () => expect((await manager.view(account.id)).qrReady).toBe(true));
    await vi.waitFor(async () => expect((await manager.view(account.id)).state).toBe('success'));
    const view = await manager.view(account.id);
    expect(view.qrReady).toBe(false);
    expect((await store.get(account.id)).userId).toBe('246810');
  });

  it('取消登录后清理临时二维码', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-login-cancel-'));
    roots.push(root);
    const fakeCore = path.join(root, 'slow-login.mjs');
    await writeFile(fakeCore, `
      import { writeFile } from 'node:fs/promises';
      import path from 'node:path';
      await writeFile(path.join(process.env.DATA_DIR, 'login-qr.png'), Buffer.from('png'));
      await new Promise((resolve) => setTimeout(resolve, 10000));
    `, 'utf8');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai');
    const account = await store.create('取消账号');
    const manager = new LoginManager(store, fakeCore, 'Asia/Shanghai');
    await manager.start(account.id);
    await vi.waitFor(async () => expect((await manager.view(account.id)).qrReady).toBe(true));
    expect((await manager.cancel(account.id)).state).toBe('cancelled');
    expect((await manager.view(account.id)).qrReady).toBe(false);
  });

  it('设备注册偶发空响应时有限重试并继续生成二维码', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-login-retry-'));
    roots.push(root);
    const fakeCore = path.join(root, 'retry-login.mjs');
    await writeFile(fakeCore, `
      import { readFile, writeFile } from 'node:fs/promises';
      import path from 'node:path';
      const counter = path.join(process.env.DATA_DIR, 'attempt.txt');
      const attempt = Number(await readFile(counter, 'utf8').catch(() => '0')) + 1;
      await writeFile(counter, String(attempt));
      if (attempt === 1) {
        console.error('❌ 设备注册响应缺少 dfid');
        process.exit(40);
      }
      await writeFile(path.join(process.env.DATA_DIR, 'login-qr.png'), Buffer.from('png'));
      console.log('二维码图片已生成');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(path.join(process.env.DATA_DIR, 'auth.json'), JSON.stringify({ userid: '135790', token: 'secret' }));
    `, 'utf8');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai');
    const account = await store.create('重试账号');
    const manager = new LoginManager(store, fakeCore, 'Asia/Shanghai', undefined, () => 0);
    await manager.start(account.id);
    await vi.waitFor(async () => expect((await manager.view(account.id)).state).toBe('success'));
    expect(await readFile(path.join(store.paths(account.id).runtime, 'attempt.txt'), 'utf8')).toBe('2');
  });

  it('设备注册持续空响应时最多尝试三次并明确失败', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-login-retry-limit-'));
    roots.push(root);
    const fakeCore = path.join(root, 'failed-register.mjs');
    await writeFile(fakeCore, `
      import { readFile, writeFile } from 'node:fs/promises';
      import path from 'node:path';
      const counter = path.join(process.env.DATA_DIR, 'attempt.txt');
      const attempt = Number(await readFile(counter, 'utf8').catch(() => '0')) + 1;
      await writeFile(counter, String(attempt));
      console.error('❌ 设备注册响应缺少 dfid');
      process.exit(40);
    `, 'utf8');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai');
    const account = await store.create('重试上限账号');
    const manager = new LoginManager(store, fakeCore, 'Asia/Shanghai', undefined, () => 0);
    await manager.start(account.id);
    await vi.waitFor(async () => expect((await manager.view(account.id)).state).toBe('failed'));
    expect(await readFile(path.join(store.paths(account.id).runtime, 'attempt.txt'), 'utf8')).toBe('3');
  });
});
