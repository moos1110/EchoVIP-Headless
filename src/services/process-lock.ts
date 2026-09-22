import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../utils/errors.js';

const processAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};

export class ProcessLock {
  private acquired = false;
  constructor(private readonly filePath: string) {}

  async acquire(): Promise<boolean> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const handle = await open(this.filePath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.close();
      this.acquired = true;
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ApiError('无法创建任务锁');
      // PID 在不同容器之间不具有唯一性。遗留锁必须人工确认后清理。
      return false;
    }
  }

  async release(): Promise<void> {
    if (this.acquired) await rm(this.filePath, { force: true });
    this.acquired = false;
  }
}
