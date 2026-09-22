import type { JsonObject } from '../types.js';
import { InvalidResponseError } from '../utils/errors.js';

export interface NormalizedVipStatus {
  claimedToday: boolean;
  claimedDays: number;
  active: boolean | null;
}

const walk = (value: unknown, visit: (record: JsonObject) => void): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  const record = value as JsonObject;
  visit(record);
  for (const child of Object.values(record)) walk(child, visit);
};

export const normalizeVipStatus = (monthRaw: unknown, unionRaw: unknown, today: string): NormalizedVipStatus => {
  if (!monthRaw || typeof monthRaw !== 'object') throw new InvalidResponseError('月度记录不是有效对象');
  const body = monthRaw as JsonObject;
  if (Number(body.status) !== 1 || Number(body.error_code ?? 0) !== 0) throw new InvalidResponseError('月度记录查询未成功');
  const data = body.data as JsonObject | undefined;
  if (!data) throw new InvalidResponseError('月度记录缺少 data，停止领取以避免误判');
  const records = Array.isArray(data.list)
    ? data.list
    : Array.isArray(data.records)
      ? data.records
      : null;
  if (!records) throw new InvalidResponseError('尚未适配该月度记录结构，停止领取以避免误判');
  const dates = new Set<string>();
  walk(records, (record) => {
    const date = record.day ?? record.receive_day;
    const received = record.receive_vip === undefined || Number(record.receive_vip) > 0;
    if (received && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
  });
  let active: boolean | null = null;
  walk(unionRaw, (record) => {
    for (const [key, value] of Object.entries(record)) {
      if (/is_vip|vip_status|valid|active/i.test(key) && (typeof value === 'boolean' || typeof value === 'number')) {
        active = value === true || Number(value) > 0;
      }
    }
  });
  const month = today.slice(0, 7);
  const claimedDays = [...dates].filter((date) => date.startsWith(`${month}-`)).length;
  return { claimedToday: dates.has(today), claimedDays, active };
};
