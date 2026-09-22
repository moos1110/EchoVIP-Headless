export type AppMode = 'provisioning' | 'server';

export interface ScheduleConfig {
  enabled: boolean;
  start: string;
  end: string;
  timeZone: string;
}

export interface PendingSchedule {
  effectiveDate: string;
  value: ScheduleConfig;
}

export interface AccountManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  schedule: ScheduleConfig;
  pendingSchedule?: PendingSchedule;
}

export interface AccountPaths {
  root: string;
  runtime: string;
  logs: string;
  manifest: string;
  scheduler: string;
}

export interface AccountSummary {
  id: string;
  name: string;
  maskedUserId: string | null;
  loggedIn: boolean;
  schedule: ScheduleConfig;
  pendingSchedule?: PendingSchedule;
  today: {
    date: string;
    status: string | null;
    at: string | null;
    error: string | null;
  };
  plannedAt: string | null;
}

export interface DailyScheduleState {
  version: 1;
  date: string;
  scheduledSecond: number;
  scheduledTime: string;
  attemptedAt: string | null;
  result: string | null;
}

export type CoreCommand = 'login' | 'status' | 'claim' | 'logout';

export interface CoreRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type LoginJobState = 'starting' | 'waiting' | 'scanned' | 'success' | 'failed' | 'cancelled' | 'duplicate';

export interface LoginJobView {
  accountId: string;
  state: LoginJobState;
  qrReady: boolean;
  message: string;
  startedAt: string;
  finishedAt: string | null;
}
