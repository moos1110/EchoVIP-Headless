import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dateInTimezone } from '../utils/date.js';
import { maskUserId, sanitizeText } from '../utils/mask.js';
import { assertDirectChild, ensureDirectory, readJson, writeJsonAtomic } from './fs-utils.js';
import type {
  AccountManifest,
  AccountPaths,
  AccountSummary,
  DailyScheduleState,
  ScheduleConfig,
} from './types.js';

const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const defaultSchedule = (timeZone: string): ScheduleConfig => ({
  enabled: false,
  start: '00:00:00',
  end: '00:10:00',
  timeZone,
});

export const timeToSecond = (value: string, allowEndOfDay = false): number => {
  if (allowEndOfDay && value === '24:00') return 86_400;
  if (!timePattern.test(value)) throw new Error(`时间格式无效：${value}`);
  const [hour = '0', minute = '0', second = '0'] = value.split(':');
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
};

export const validateSchedule = (schedule: ScheduleConfig): ScheduleConfig => {
  const normalized: ScheduleConfig = {
    enabled: Boolean(schedule.enabled),
    start: schedule.start.length === 5 ? `${schedule.start}:00` : schedule.start,
    end: schedule.end === '24:00' ? schedule.end : schedule.end.length === 5 ? `${schedule.end}:00` : schedule.end,
    timeZone: schedule.timeZone,
  };
  const start = timeToSecond(normalized.start);
  const end = timeToSecond(normalized.end, true);
  if (start >= end) throw new Error('签到时间窗必须在同一天内，且结束时间晚于开始时间');
  try { new Intl.DateTimeFormat('en-US', { timeZone: normalized.timeZone }).format(); }
  catch { throw new Error(`无效时区：${normalized.timeZone}`); }
  return normalized;
};

const nextDate = (date: string): string => {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
};

interface StoredAuth { userid?: unknown; }
interface StoredState {
  lastClaimDate?: unknown;
  lastClaimStatus?: unknown;
  lastClaimAt?: unknown;
  lastError?: unknown;
}

export class AccountStore {
  constructor(
    readonly accountsDir: string,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initialize(): Promise<void> {
    await ensureDirectory(this.accountsDir);
  }

  paths(id: string): AccountPaths {
    if (!accountIdPattern.test(id)) throw new Error('账号 ID 无效');
    const root = path.join(this.accountsDir, id);
    assertDirectChild(this.accountsDir, root);
    return {
      root,
      runtime: path.join(root, 'runtime'),
      logs: path.join(root, 'logs'),
      manifest: path.join(root, 'account.json'),
      scheduler: path.join(root, 'runtime', 'scheduler.json'),
    };
  }

  async create(name: string, schedule?: ScheduleConfig): Promise<AccountManifest> {
    await this.initialize();
    const id = randomUUID();
    const paths = this.paths(id);
    await mkdir(paths.root, { recursive: false, mode: 0o700 });
    await ensureDirectory(paths.runtime);
    await ensureDirectory(paths.logs);
    const now = this.now().toISOString();
    const manifest: AccountManifest = {
      schemaVersion: 1,
      id,
      name: this.validateName(name),
      userId: null,
      createdAt: now,
      updatedAt: now,
      schedule: validateSchedule(schedule ?? defaultSchedule(this.timeZone)),
    };
    await writeJsonAtomic(paths.manifest, manifest);
    return manifest;
  }

  async list(): Promise<AccountManifest[]> {
    await this.initialize();
    const entries = await readdir(this.accountsDir, { withFileTypes: true });
    const manifests: AccountManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !accountIdPattern.test(entry.name)) continue;
      const manifest = await this.get(entry.name);
      manifests.push(manifest);
    }
    return manifests.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async get(id: string): Promise<AccountManifest> {
    const paths = this.paths(id);
    const manifest = await readJson<AccountManifest>(paths.manifest);
    if (!manifest || manifest.schemaVersion !== 1 || manifest.id !== id) throw new Error('账号配置不存在或已损坏');
    validateSchedule(manifest.schedule);
    const today = dateInTimezone(this.timeZone, this.now());
    if (manifest.pendingSchedule && manifest.pendingSchedule.effectiveDate <= today) {
      const promoted: AccountManifest = {
        ...manifest,
        schedule: validateSchedule(manifest.pendingSchedule.value),
        updatedAt: this.now().toISOString(),
      };
      delete promoted.pendingSchedule;
      await writeJsonAtomic(paths.manifest, promoted);
      return promoted;
    }
    return manifest;
  }

  async update(id: string, input: { name?: string; schedule?: ScheduleConfig }, deferSchedule: boolean): Promise<AccountManifest> {
    const current = await this.get(id);
    const updated: AccountManifest = {
      ...current,
      name: input.name === undefined ? current.name : this.validateName(input.name),
      updatedAt: this.now().toISOString(),
    };
    if (input.schedule) {
      const schedule = validateSchedule(input.schedule);
      if (deferSchedule) {
        updated.pendingSchedule = {
          effectiveDate: nextDate(dateInTimezone(this.timeZone, this.now())),
          value: schedule,
        };
      } else {
        updated.schedule = schedule;
        delete updated.pendingSchedule;
      }
    }
    await writeJsonAtomic(this.paths(id).manifest, updated);
    return updated;
  }

  async setUserId(id: string, userId: string): Promise<AccountManifest> {
    if (!/^\d+$/.test(userId) || userId === '0') throw new Error('登录结果缺少有效用户 ID');
    const duplicate = await this.findByUserId(userId, id);
    if (duplicate) throw new Error(`该酷狗账号已存在：${duplicate.name}`);
    const current = await this.get(id);
    const updated: AccountManifest = { ...current, userId, updatedAt: this.now().toISOString() };
    await writeJsonAtomic(this.paths(id).manifest, updated);
    return updated;
  }

  async disableSchedule(id: string): Promise<AccountManifest> {
    const current = await this.get(id);
    const updated: AccountManifest = {
      ...current,
      schedule: { ...current.schedule, enabled: false },
      updatedAt: this.now().toISOString(),
    };
    delete updated.pendingSchedule;
    await writeJsonAtomic(this.paths(id).manifest, updated);
    return updated;
  }

  async findByUserId(userId: string, exceptId?: string): Promise<AccountManifest | null> {
    for (const account of await this.list()) {
      if (account.id !== exceptId && account.userId === userId) return account;
      if (account.id === exceptId || account.userId) continue;
      const auth = await readJson<StoredAuth>(path.join(this.paths(account.id).runtime, 'auth.json'));
      if (String(auth?.userid ?? '') === userId) return account;
    }
    return null;
  }

  async summary(id: string): Promise<AccountSummary> {
    const manifest = await this.get(id);
    const paths = this.paths(id);
    const auth = await readJson<StoredAuth>(path.join(paths.runtime, 'auth.json'));
    const state = await readJson<StoredState>(path.join(paths.runtime, 'state.json'));
    const plan = await readJson<DailyScheduleState>(paths.scheduler);
    const userId = String(auth?.userid ?? manifest.userId ?? '');
    return {
      id,
      name: manifest.name,
      maskedUserId: userId ? maskUserId(userId) : null,
      loggedIn: Boolean(userId),
      schedule: manifest.schedule,
      ...(manifest.pendingSchedule ? { pendingSchedule: manifest.pendingSchedule } : {}),
      today: {
        date: String(state?.lastClaimDate ?? ''),
        status: state?.lastClaimStatus == null ? null : String(state.lastClaimStatus),
        at: state?.lastClaimAt == null ? null : String(state.lastClaimAt),
        error: state?.lastError == null ? null : sanitizeText(String(state.lastError)),
      },
      plannedAt: plan?.date === dateInTimezone(this.timeZone, this.now()) ? plan.scheduledTime : null,
    };
  }

  async summaries(): Promise<AccountSummary[]> {
    return Promise.all((await this.list()).map((account) => this.summary(account.id)));
  }

  async delete(id: string): Promise<void> {
    const paths = this.paths(id);
    await this.get(id);
    await rm(paths.root, { recursive: true, force: false });
  }

  async hardenPermissions(id: string): Promise<void> {
    if (process.platform === 'win32') return;
    const paths = this.paths(id);
    await chmod(paths.root, 0o700);
    await chmod(paths.runtime, 0o700);
    await chmod(paths.logs, 0o700);
    for (const file of ['account.json', 'runtime/auth.json', 'runtime/device.json', 'runtime/state.json']) {
      await chmod(path.join(paths.root, file), 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  private validateName(value: string): string {
    const name = value.trim();
    if (name.length < 1 || name.length > 40) throw new Error('账号名称需要 1–40 个字符');
    return name;
  }
}
