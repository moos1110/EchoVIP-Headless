export const maskSecret = (value: string, visible = 3): string => {
  if (!value) return '未设置';
  if (value.length <= visible * 2) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, visible)}********${value.slice(-visible)}`;
};

export const maskUserId = (value: string): string => {
  if (value.length <= 4) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(3, value.length - 4))}${value.slice(-2)}`;
};

export const sanitizeText = (value: string): string => value
  .replace(/(token|vip_token|cookie|authorization)(["'=:\s]+)([^\s;",}]+)/gi, '$1$2[REDACTED]')
  .replace(/1\d{2}\d{4}\d{4}/g, '$1****$2');

