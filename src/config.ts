import 'dotenv/config';
import path from 'node:path';

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  timezone: process.env.TZ?.trim() || 'Asia/Shanghai',
  dataDir: path.resolve(process.env.DATA_DIR?.trim() || './data'),
  logDir: path.resolve(process.env.LOG_DIR?.trim() || './logs'),
  requestTimeoutMs: positiveInt(process.env.REQUEST_TIMEOUT_MS, 15_000),
  maxRetries: Math.min(positiveInt(process.env.MAX_RETRIES, 2), 3),
  logLevel: process.env.LOG_LEVEL?.trim().toLowerCase() || 'info',
  // 不继承终端或系统注入的通用代理；只有用户明确为酷狗接口配置时才启用。
  proxy: process.env.KUGOU_API_PROXY?.trim() || '',
  appid: 3116,
  clientver: 11440,
  srcappid: 2919,
  platform: 'lite' as const,
};
