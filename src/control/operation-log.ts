import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sanitizeText } from '../utils/mask.js';
import type { AccountPaths } from './types.js';

export type OperationSource = 'manual' | 'automatic' | 'system';
export type OperationStatus = 'planned' | 'running' | 'success' | 'failed' | 'blocked' | 'cancelled' | 'info';

export interface OperationRecord {
  version: 1;
  id: string;
  accountId: string;
  source: OperationSource;
  action: string;
  status: OperationStatus;
  title: string;
  message: string;
  occurredAt: string;
  exitCode?: number;
}

export interface OperationInput {
  source: OperationSource;
  action: string;
  status: OperationStatus;
  title: string;
  message?: string;
  exitCode?: number;
}

const maxTextLength = 2_000;

const clean = (value: string): string => sanitizeText(value).replace(/\s+/g, ' ').trim().slice(0, maxTextLength);

export class OperationLog {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async append(accountId: string, paths: AccountPaths, input: OperationInput): Promise<OperationRecord> {
    const record: OperationRecord = {
      version: 1,
      id: randomUUID(),
      accountId,
      source: input.source,
      action: clean(input.action),
      status: input.status,
      title: clean(input.title),
      message: clean(input.message ?? ''),
      occurredAt: this.now().toISOString(),
      ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    };
    await mkdir(paths.logs, { recursive: true });
    await appendFile(path.join(paths.logs, 'operations.jsonl'), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    return record;
  }

  async list(paths: AccountPaths, limit = 200): Promise<OperationRecord[]> {
    const content = await readFile(path.join(paths.logs, 'operations.jsonl'), 'utf8').catch(() => '');
    const records: OperationRecord[] = [];
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const candidate = JSON.parse(line) as Partial<OperationRecord>;
        if (candidate.version !== 1 || typeof candidate.id !== 'string' || typeof candidate.occurredAt !== 'string') continue;
        if (!['manual', 'automatic', 'system'].includes(String(candidate.source))) continue;
        if (!['planned', 'running', 'success', 'failed', 'blocked', 'cancelled', 'info'].includes(String(candidate.status))) continue;
        records.push({
          version: 1,
          id: candidate.id,
          accountId: String(candidate.accountId ?? ''),
          source: candidate.source as OperationSource,
          action: clean(String(candidate.action ?? '')),
          status: candidate.status as OperationStatus,
          title: clean(String(candidate.title ?? '')),
          message: clean(String(candidate.message ?? '')),
          occurredAt: candidate.occurredAt,
          ...(typeof candidate.exitCode === 'number' ? { exitCode: candidate.exitCode } : {}),
        });
      } catch { /* 忽略被截断或不是 JSON 的单行，不影响其他记录。 */ }
    }
    return records.slice(-Math.max(1, Math.min(limit, 500))).reverse();
  }
}
