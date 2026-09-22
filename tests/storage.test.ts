import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../src/storage/json-store.js';
import { StorageError } from '../src/utils/errors.js';

const directories: string[] = [];
const temporaryStore = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'echovip-storage-'));
  directories.push(directory);
  return new JsonStore<{ value: number }>(path.join(directory, 'state.json'));
};

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('JsonStore', () => {
  it('文件不存在时返回 null', async () => {
    expect(await (await temporaryStore()).read()).toBeNull();
  });

  it('原子保存并再次读取 JSON', async () => {
    const store = await temporaryStore();
    await store.write({ value: 42 });
    expect(await store.read()).toEqual({ value: 42 });
    expect(await readFile(store.filePath, 'utf8')).toContain('42');
  });

  it('损坏文件返回 StorageError', async () => {
    const store = await temporaryStore();
    await writeFile(store.filePath, '{bad json', 'utf8');
    await expect(store.read()).rejects.toBeInstanceOf(StorageError);
  });
});

