import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AccountStore } from './account-store.js';
import { readJson } from './fs-utils.js';
import { OperationLog } from './operation-log.js';
import type { LoginJobState, LoginJobView } from './types.js';

interface AuthFile { userid?: unknown; }

interface LoginJob {
  accountId: string;
  state: LoginJobState;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  child: ChildProcess | null;
  timer: NodeJS.Timeout | null;
  attempts: number;
}

const maxDeviceRegistrationAttempts = 3;

export class LoginManager {
  private readonly jobs = new Map<string, LoginJob>();

  constructor(
    private readonly accounts: AccountStore,
    private readonly coreEntry: string,
    private readonly timeZone: string,
    private readonly operationLog?: OperationLog,
    private readonly retryDelay: (completedAttempts: number) => number = (completedAttempts) => completedAttempts * 1_200,
  ) {}

  isActive(accountId: string): boolean {
    const state = this.jobs.get(accountId)?.state;
    return state === 'starting' || state === 'waiting' || state === 'scanned';
  }

  async start(accountId: string): Promise<LoginJobView> {
    if (this.isActive(accountId)) return this.view(accountId);
    await this.accounts.get(accountId);
    const job: LoginJob = {
      accountId,
      state: 'starting',
      message: '正在生成二维码',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      child: null,
      timer: null,
      attempts: 0,
    };
    this.jobs.set(accountId, job);
    await this.record(job, 'running', '扫码登录已启动', '正在生成酷狗概念版登录二维码');
    this.launch(job);
    return this.view(accountId);
  }

  private launch(job: LoginJob): void {
    const paths = this.accounts.paths(job.accountId);
    job.attempts += 1;
    const child = spawn(process.execPath, [this.coreEntry, 'login'], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, DATA_DIR: paths.runtime, LOG_DIR: paths.logs, TZ: this.timeZone, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.child = child;
    let output = '';
    const consume = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-16_384);
      if (output.includes('已扫码')) { job.state = 'scanned'; job.message = '已扫码，请在手机上确认'; }
      else if (output.includes('等待扫码')) { job.state = 'waiting'; job.message = '等待扫码'; }
      else if (output.includes('二维码图片')) { job.state = 'waiting'; job.message = '二维码已生成，请扫码'; }
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    job.timer = setTimeout(() => child.kill(), 210_000);
    child.once('error', (error) => {
      this.finish(job, 'failed', error.message);
      void this.record(job, 'failed', '扫码登录异常', error.message);
    });
    child.once('close', (code) => {
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      job.child = null;
      void this.handleClose(job, code ?? 1, output);
    });
  }

  async cancel(accountId: string): Promise<LoginJobView> {
    const job = this.jobs.get(accountId);
    if (!job || !this.isActive(accountId)) throw new Error('当前没有进行中的登录');
    job.state = 'cancelled';
    job.message = '登录已取消';
    job.child?.kill();
    this.finish(job, 'cancelled', '登录已取消');
    await this.record(job, 'cancelled', '扫码登录已取消', '二维码已失效并清理');
    await rm(path.join(this.accounts.paths(accountId).runtime, 'login-qr.png'), { force: true });
    return this.view(accountId);
  }

  async view(accountId: string): Promise<LoginJobView> {
    const job = this.jobs.get(accountId);
    if (!job) {
      return {
        accountId,
        state: 'failed',
        qrReady: false,
        message: '尚未启动登录',
        startedAt: '',
        finishedAt: null,
      };
    }
    const qrPath = path.join(this.accounts.paths(accountId).runtime, 'login-qr.png');
    const qrReady = await readFile(qrPath).then(() => true).catch(() => false);
    return {
      accountId,
      state: job.state,
      qrReady,
      message: job.message,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  private async handleClose(job: LoginJob, exitCode: number, output: string): Promise<void> {
    if (job.state === 'cancelled' || job.state === 'failed') return;
    const paths = this.accounts.paths(job.accountId);
    if (exitCode !== 0) {
      const message = output.split(/\r?\n/).filter((line) => line.startsWith('❌')).pop() ?? '二维码登录失败';
      const cleanMessage = message.replace(/^❌\s*/, '');
      if (cleanMessage.includes('设备注册响应缺少 dfid') && job.attempts < maxDeviceRegistrationAttempts) {
        job.state = 'starting';
        job.message = `设备注册暂未返回标识，正在进行第 ${job.attempts + 1} 次尝试`;
        await this.record(job, 'running', '设备注册空响应，准备重试', `第 ${job.attempts} 次响应未包含 dfid，稍后自动重试`);
        job.timer = setTimeout(() => this.launch(job), this.retryDelay(job.attempts));
        return;
      }
      this.finish(job, 'failed', cleanMessage);
      await this.record(job, 'failed', '扫码登录失败', job.message);
      await rm(path.join(paths.runtime, 'login-qr.png'), { force: true });
      return;
    }
    const auth = await readJson<AuthFile>(path.join(paths.runtime, 'auth.json'));
    const userId = String(auth?.userid ?? '');
    try {
      await this.accounts.setUserId(job.accountId, userId);
      this.finish(job, 'success', '登录成功');
      await this.record(job, 'success', '扫码登录成功', '认证信息已保存，二维码已清理');
    } catch (error) {
      await rm(path.join(paths.runtime, 'auth.json'), { force: true });
      this.finish(job, 'duplicate', error instanceof Error ? error.message : String(error));
      await this.record(job, 'blocked', '扫码登录被阻止', job.message);
    } finally {
      await rm(path.join(paths.runtime, 'login-qr.png'), { force: true });
    }
  }

  private finish(job: LoginJob, state: LoginJobState, message: string): void {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    job.child = null;
    job.state = state;
    job.message = message;
    job.finishedAt = new Date().toISOString();
  }

  private async record(
    job: LoginJob,
    status: 'running' | 'success' | 'failed' | 'blocked' | 'cancelled',
    title: string,
    message: string,
  ): Promise<void> {
    if (!this.operationLog) return;
    await this.operationLog.append(job.accountId, this.accounts.paths(job.accountId), {
      source: 'manual', action: 'login', status, title, message,
    }).catch(() => undefined);
  }
}
