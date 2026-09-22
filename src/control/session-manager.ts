import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

interface SessionRecord {
  csrfToken: string;
  expiresAt: number;
}

const hash = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly passwordHash: Buffer;

  constructor(password: string, private readonly lifetimeMs = 12 * 60 * 60_000) {
    this.passwordHash = hash(password);
  }

  verifyPassword(candidate: string): boolean {
    return timingSafeEqual(this.passwordHash, hash(candidate));
  }

  create(): { id: string; csrfToken: string; expiresAt: number } {
    this.cleanup();
    const id = randomBytes(32).toString('base64url');
    const record: SessionRecord = {
      csrfToken: randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + this.lifetimeMs,
    };
    this.sessions.set(id, record);
    return { id, ...record };
  }

  get(id: string | undefined): SessionRecord | null {
    if (!id) return null;
    const record = this.sessions.get(id);
    if (!record || record.expiresAt <= Date.now()) {
      if (record) this.sessions.delete(id);
      return null;
    }
    record.expiresAt = Date.now() + this.lifetimeMs;
    return record;
  }

  delete(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, record] of this.sessions) if (record.expiresAt <= now) this.sessions.delete(id);
  }
}
