import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../src/control/account-store.js';
import { CoreRunner } from '../src/control/core-runner.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('CoreRunner', () => {
  it('只把目标账号的数据和日志目录传给冻结核心，并脱敏日志', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'echovip-runner-'));
    roots.push(root);
    const fakeCore = path.join(root, 'fake-core.mjs');
    await writeFile(fakeCore, "console.log(JSON.stringify({ command: process.argv[2], data: process.env.DATA_DIR, logs: process.env.LOG_DIR }));\n", 'utf8');
    const store = new AccountStore(path.join(root, 'accounts'), 'Asia/Shanghai');
    const account = await store.create('隔离账号');
    const paths = store.paths(account.id);
    const runner = new CoreRunner(fakeCore, path.join(root, 'control', 'operation.lock'), 'Asia/Shanghai');
    const result = await runner.run(account.id, paths, 'status');
    const output = JSON.parse(result.stdout) as { command: string; data: string; logs: string };
    expect(output).toEqual({ command: 'status', data: paths.runtime, logs: paths.logs });
    await mkdir(paths.logs, { recursive: true });
    await writeFile(path.join(paths.logs, 'sample.log'), 'token=very-secret\nauthorization: bearer-secret\n', 'utf8');
    expect((await runner.recentLogs(paths)).join('\n')).not.toContain('very-secret');
    expect((await runner.recentLogs(paths)).join('\n')).not.toContain('bearer-secret');
  });
});
