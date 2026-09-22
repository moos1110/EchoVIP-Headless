import { RiskControlError } from '../utils/errors.js';

const riskTerms = ['安全验证', '账号验证', '滑块', '验证码', '设备验证', 'ssa'];

const messageKey = /^(?:message|msg|error|error_msg|errmsg|error_message|reason|verify|verification|risk|captcha)$/i;

const collectRiskMessages = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  const messages: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && messageKey.test(key)) messages.push(item);
    else if (item && typeof item === 'object') messages.push(...collectRiskMessages(item));
  }
  return messages;
};

export const hasRiskControl = (body: unknown, headers: Record<string, string> = {}): boolean => {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const code = Number(record.error_code ?? record.errcode ?? record.code ?? 0);
  const messages = collectRiskMessages(body).join('\n').toLowerCase();
  return code === 20028 || Boolean(headers['ssa-code']) || riskTerms.some((term) => messages.includes(term.toLowerCase()));
};

export const assertNoRiskControl = (body: unknown, headers: Record<string, string> = {}): void => {
  if (hasRiskControl(body, headers)) throw new RiskControlError();
};
