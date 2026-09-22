import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const ensureDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700);
};

export const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export const writeJsonAtomic = async <T>(filePath: string, value: T): Promise<void> => {
  await ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
    if (process.platform !== 'win32') await chmod(filePath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const pathExists = async (target: string): Promise<boolean> => {
  try { await stat(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const assertDirectChild = (parent: string, child: string): void => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error('目标路径不在允许的账号目录中');
  }
};
