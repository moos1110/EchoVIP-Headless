import { open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureDirectory } from './fs-utils.js';

export class BusyError extends Error {
  constructor(message = '已有任务正在运行，请稍后再试') {
    super(message);
    this.name = 'BusyError';
  }
}

interface LockInfo { pid: number; createdAt: string; }

export const withFileLock = async <T>(
  lockPath: string,
  action: () => Promise<T>,
  staleAfterMs = 15 * 60_000,
): Promise<T> => {
  await ensureDirectory(path.dirname(lockPath));
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const info = JSON.parse(await readFile(lockPath, 'utf8')) as LockInfo;
      stale = Date.now() - new Date(info.createdAt).getTime() > staleAfterMs;
    } catch {
      stale = true;
    }
    if (!stale) throw new BusyError();
    await rm(lockPath, { force: true });
    handle = await open(lockPath, 'wx', 0o600);
  }

  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try { return await action(); }
  finally { await rm(lockPath, { force: true }); }
};
