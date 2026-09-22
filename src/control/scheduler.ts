import { randomInt } from 'node:crypto';
import path from 'node:path';
import { dateInTimezone } from '../utils/date.js';
import { AccountStore, timeToSecond } from './account-store.js';
import { CoreRunner } from './core-runner.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { BusyError, withFileLock } from './locks.js';
import { OperationLog } from './operation-log.js';
import type { DailyScheduleState } from './types.js';

interface TaskState { lastClaimDate?: unknown; lastClaimStatus?: unknown; }
interface AuthState { userid?: unknown; }

const successfulStates = new Set(['SUCCESS', 'ALREADY']);

const secondsInTimezone = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second);
};

const formatSecond = (value: number): string => {
  const hour = Math.floor(value / 3600);
  const minute = Math.floor((value % 3600) / 60);
  const second = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
};

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AccountScheduler {
  constructor(
    private readonly accounts: AccountStore,
    private readonly runner: CoreRunner,
    private readonly schedulerLock: string,
    private readonly now: () => Date = () => new Date(),
    private readonly random: (minimum: number, maximum: number) => number = randomInt,
    private readonly wait: (milliseconds: number) => Promise<void> = sleep,
    private readonly operationLog?: OperationLog,
  ) {}

  async tick(): Promise<void> {
    await withFileLock(this.schedulerLock, async () => {
      const due: Array<{ id: string; state: DailyScheduleState }> = [];
      for (const account of await this.accounts.list()) {
        if (!account.schedule.enabled) continue;
        const paths = this.accounts.paths(account.id);
        const auth = await readJson<AuthState>(path.join(paths.runtime, 'auth.json'));
        if (!auth?.userid) {
          await this.accounts.disableSchedule(account.id);
          await this.record(account.id, 'blocked', '自动签到已暂停', '登录状态不存在，请重新登录后手动启用');
          continue;
        }
        const today = dateInTimezone(account.schedule.timeZone, this.now());
        const taskState = await readJson<TaskState>(path.join(paths.runtime, 'state.json'));
        let plan = await readJson<DailyScheduleState>(paths.scheduler);
        if (!plan || plan.date !== today) {
          const start = timeToSecond(account.schedule.start);
          const end = timeToSecond(account.schedule.end, true);
          const scheduledSecond = this.random(start, end);
          plan = {
            version: 1,
            date: today,
            scheduledSecond,
            scheduledTime: formatSecond(scheduledSecond),
            attemptedAt: null,
            result: null,
          };
          await writeJsonAtomic(paths.scheduler, plan);
          await this.record(account.id, 'planned', '已生成今日自动签到计划', `计划执行时间 ${plan.scheduledTime}`);
        }
        if (String(taskState?.lastClaimDate ?? '') === today && successfulStates.has(String(taskState?.lastClaimStatus ?? ''))) {
          if (!plan.attemptedAt) {
            plan = { ...plan, attemptedAt: this.now().toISOString(), result: 'ALREADY_MANUAL' };
            await writeJsonAtomic(paths.scheduler, plan);
            await this.record(account.id, 'info', '今日计划已完成', '检测到今日已手动签到成功，自动任务不再重复执行');
          }
          continue;
        }
        if (plan.attemptedAt) continue;
        const nowSecond = secondsInTimezone(this.now(), account.schedule.timeZone);
        if (plan.scheduledSecond <= nowSecond || Math.floor(plan.scheduledSecond / 60) === Math.floor(nowSecond / 60)) {
          due.push({ id: account.id, state: plan });
        }
      }

      due.sort((left, right) => left.state.scheduledSecond - right.state.scheduledSecond);
      for (const item of due) await this.execute(item.id, item.state);
    });
  }

  private async execute(accountId: string, plan: DailyScheduleState): Promise<void> {
    const account = await this.accounts.get(accountId);
    const paths = this.accounts.paths(accountId);
    const currentSecond = secondsInTimezone(this.now(), account.schedule.timeZone);
    if (plan.scheduledSecond > currentSecond) {
      await this.wait((plan.scheduledSecond - currentSecond) * 1000);
    }
    const attempted: DailyScheduleState = { ...plan, attemptedAt: this.now().toISOString(), result: 'RUNNING' };
    await writeJsonAtomic(paths.scheduler, attempted);
    await this.record(accountId, 'running', '自动签到开始执行', `计划时间 ${plan.scheduledTime}`);
    try {
      const result = await this.runner.run(accountId, paths, 'claim');
      const finalState: DailyScheduleState = {
        ...attempted,
        result: result.exitCode === 0 ? 'SUCCESS' : `EXIT_${result.exitCode}`,
      };
      await writeJsonAtomic(paths.scheduler, finalState);
      await this.record(
        accountId,
        result.exitCode === 0 ? 'success' : 'failed',
        result.exitCode === 0 ? '自动签到完成' : '自动签到失败',
        result.stdout || result.stderr || `核心命令退出码 ${result.exitCode}`,
        result.exitCode,
      );
      if ([10, 11, 20].includes(result.exitCode)) await this.accounts.disableSchedule(accountId);
    } catch (error) {
      if (error instanceof BusyError) {
        await writeJsonAtomic(paths.scheduler, { ...attempted, attemptedAt: null, result: 'BUSY_RETRY_NEXT_TICK' });
        await this.record(accountId, 'blocked', '自动签到暂缓', '全局任务锁被占用，将在下一次调度检查时重试');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await writeJsonAtomic(paths.scheduler, { ...attempted, result: `FAILED: ${message}` });
      await this.record(accountId, 'failed', '自动签到异常', message);
    }
  }

  private async record(accountId: string, status: 'planned' | 'running' | 'success' | 'failed' | 'blocked' | 'info', title: string, message: string, exitCode?: number): Promise<void> {
    if (!this.operationLog) return;
    await this.operationLog.append(accountId, this.accounts.paths(accountId), {
      source: 'automatic', action: 'claim', status, title, message,
      ...(exitCode === undefined ? {} : { exitCode }),
    }).catch(() => undefined);
  }
}
