import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildControlServer } from '../src/control/server.js';
import type { ControlConfig } from '../src/control/config.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('Web 控制层', () => {
  it('要求面板密码和 CSRF，并从后端禁止本地模式签到', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-server-'));
    roots.push(root);
    const web = path.join(root, 'web');
    await mkdir(web);
    await writeFile(path.join(web, 'index.html'), '<!doctype html><title>test</title>', 'utf8');
    const config: ControlConfig = {
      mode: 'provisioning',
      accountsDir: path.join(root, 'accounts'),
      controlDir: path.join(root, 'control'),
      coreEntry: path.join(root, 'fake-core.mjs'),
      webDistDir: web,
      host: '127.0.0.1',
      port: 8787,
      timeZone: 'Asia/Shanghai',
      panelPassword: 'local-password',
      sessionSecret: '12345678901234567890123456789012',
      secureCookies: false,
    };
    const app = await buildControlServer(config);
    await app.ready();
    const origin = 'http://localhost';
    const wrong = await app.inject({ method: 'POST', url: '/api/session/login', headers: { origin, host: 'localhost' }, payload: { password: 'wrong-password' } });
    expect(wrong.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/session/login', headers: { origin, host: 'localhost' }, payload: { password: 'local-password' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
    const csrf = login.json<{ csrfToken: string }>().csrfToken;
    const created = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { origin, host: 'localhost', cookie, 'x-csrf-token': csrf },
      payload: { name: '本地账号' },
    });
    expect(created.statusCode).toBe(201);
    const accountId = created.json<{ account: { id: string } }>().account.id;
    const logs = await app.inject({ method: 'GET', url: `/api/accounts/${accountId}/logs`, headers: { host: 'localhost', cookie } });
    expect(logs.statusCode).toBe(200);
    expect(logs.json<{ operations: Array<{ title: string }> }>().operations[0]?.title).toBe('账号目录已创建');
    const blocked = await app.inject({
      method: 'POST', url: `/api/accounts/${accountId}/claim`,
      headers: { origin, host: 'localhost', cookie, 'x-csrf-token': csrf },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: string }>().error).toContain('本地准备模式');
    const crossSite = await app.inject({
      method: 'PATCH', url: `/api/accounts/${accountId}`,
      headers: { origin: 'https://evil.example', host: 'localhost', cookie, 'x-csrf-token': csrf },
      payload: { name: '恶意修改' },
    });
    expect(crossSite.statusCode).toBe(403);
    const removed = await app.inject({
      method: 'DELETE', url: `/api/accounts/${accountId}`,
      headers: { origin, host: 'localhost', cookie, 'x-csrf-token': csrf },
      payload: { confirmId: accountId },
    });
    expect(removed.statusCode).toBe(200);
    const listed = await app.inject({ method: 'GET', url: '/api/accounts', headers: { host: 'localhost', cookie } });
    expect(listed.json<{ accounts: unknown[] }>().accounts).toHaveLength(0);
    await app.close();
  });
});
