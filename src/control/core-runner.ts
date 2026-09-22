import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { sanitizeText } from '../utils/mask.js';
import { pathExists } from './fs-utils.js';
import { withFileLock } from './locks.js';
import type { AccountPaths, CoreCommand, CoreRunResult } from './types.js';

const MAX_CAPTURE = 128 * 1024;

const appendCapture = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString('utf8');
  return next.length > MAX_CAPTURE ? next.slice(-MAX_CAPTURE) : next;
};

export class CoreRunner {
  private readonly active = new Set<string>();

  constructor(
    private readonly coreEntry: string,
    private readonly operationLock: string,
    private readonly timeZone: string,
  ) {}

  isActive(accountId: string): boolean { return this.active.has(accountId); }

  async hasCoreClaimLock(paths: AccountPaths): Promise<boolean> {
    return pathExists(path.join(paths.runtime, 'claim.lock'));
  }

  async run(
    accountId: string,
    paths: AccountPaths,
    command: Exclude<CoreCommand, 'login'>,
    timeoutMs = 5 * 60_000,
  ): Promise<CoreRunResult> {
    if (this.active.has(accountId)) throw new Error('该账号已有任务正在运行');
    const execute = async (): Promise<CoreRunResult> => {
      this.active.add(accountId);
      try {
        const result = await this.spawn(paths, command, timeoutMs);
        await this.writeControlLog(paths, `${command} 结束，退出码 ${result.exitCode}${result.stderr ? `，${result.stderr}` : ''}`);
        return result;
      } finally {
        this.active.delete(accountId);
      }
    };
    return command === 'claim' ? withFileLock(this.operationLock, execute) : execute();
  }

  async recentLogs(paths: AccountPaths, maxLines = 120): Promise<string[]> {
    await mkdir(paths.logs, { recursive: true });
    const names = (await readdir(paths.logs)).filter((name) => name.endsWith('.log')).sort().reverse();
    const lines: string[] = [];
    for (const name of names) {
      const content = await readFile(path.join(paths.logs, name), 'utf8').catch(() => '');
      lines.unshift(...content.split(/\r?\n/).filter(Boolean).map(sanitizeText));
      if (lines.length >= maxLines) break;
    }
    return lines.slice(-maxLines);
  }

  private spawn(paths: AccountPaths, command: Exclude<CoreCommand, 'login'>, timeoutMs: number): Promise<CoreRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.coreEntry, command], {
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          DATA_DIR: paths.runtime,
          LOG_DIR: paths.logs,
          TZ: this.timeZone,
          FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => { stdout = appendCapture(stdout, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = appendCapture(stderr, chunk); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (timedOut) { reject(new Error(`${command} 执行超时`)); return; }
        resolve({
          exitCode: code ?? 1,
          stdout: sanitizeText(stdout).trim(),
          stderr: sanitizeText(stderr).trim(),
        });
      });
    });
  }

  private async writeControlLog(paths: AccountPaths, message: string): Promise<void> {
    await mkdir(paths.logs, { recursive: true });
    const timestamp = new Intl.DateTimeFormat('zh-CN', {
      timeZone: this.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date());
    await appendFile(path.join(paths.logs, 'control.log'), `${timestamp} [CONTROL] ${sanitizeText(message)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}
