import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { dateInTimezone, localDateTime } from './date.js';
import { sanitizeText } from './mask.js';

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
const ranks: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(private readonly directory = config.logDir) {}

  debug(message: string): Promise<void> { return this.write('DEBUG', message); }
  info(message: string): Promise<void> { return this.write('INFO', message); }
  warn(message: string): Promise<void> { return this.write('WARN', message); }
  error(message: string): Promise<void> { return this.write('ERROR', message); }
  success(message: string): Promise<void> { return this.write('SUCCESS', message); }

  private async write(level: Level, message: string): Promise<void> {
    if (level === 'DEBUG' && (ranks[config.logLevel] ?? 20) > 10) return;
    const clean = sanitizeText(message);
    const line = `${localDateTime(config.timezone)} [${level}] ${clean}`;
    const consoleMethod = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    consoleMethod(line);
    await mkdir(this.directory, { recursive: true });
    await appendFile(path.join(this.directory, `${dateInTimezone(config.timezone)}.log`), `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

export const logger = new Logger();

