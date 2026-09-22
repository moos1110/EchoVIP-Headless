import { mkdir, open, readFile, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageError } from '../utils/errors.js';

export class JsonStore<T> {
  constructor(readonly filePath: string) {}

  async read(): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(`无法读取或解析 ${path.basename(this.filePath)}`, error);
    }
  }

  async write(value: T): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      const handle = await open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.filePath);
      if (process.platform !== 'win32') await chmod(this.filePath, 0o600);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw new StorageError(`无法安全写入 ${path.basename(this.filePath)}`, error);
    }
  }

  async delete(): Promise<void> {
    try { await rm(this.filePath, { force: true }); }
    catch (error) { throw new StorageError(`无法删除 ${path.basename(this.filePath)}`, error); }
  }
}

