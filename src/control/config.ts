import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppMode } from './types.js';

export interface ControlConfig {
  mode: AppMode;
  accountsDir: string;
  controlDir: string;
  coreEntry: string;
  webDistDir: string;
  host: string;
  port: number;
  timeZone: string;
  panelPassword: string;
  sessionSecret: string;
  secureCookies: boolean;
  panelDomain?: string;
  publicBaseUrl?: string;
}

const compiledRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requireMode = (raw: string | undefined): AppMode => {
  const value = raw ?? 'provisioning';
  if (value !== 'provisioning' && value !== 'server') {
    throw new Error('APP_MODE 只能是 provisioning 或 server');
  }
  return value;
};

const requirePort = (raw: string | undefined): number => {
  const value = Number(raw ?? 8787);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('WEB_PORT 无效');
  return value;
};

const normalizeDomain = (raw: string | undefined): string => {
  const value = (raw ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!value) return '';
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
    throw new Error('PANEL_DOMAIN 必须是纯域名，不能包含协议、路径或端口');
  }
  return value;
};

const normalizePublicBaseUrl = (raw: string | undefined, panelDomain: string): string => {
  const value = (raw ?? '').trim() || (panelDomain ? `https://${panelDomain}` : '');
  if (!value) return '';
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('PUBLIC_BASE_URL 必须是完整的 http 或 https 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL 只能包含协议、域名和可选端口');
  }
  return url.origin;
};

export const loadControlConfig = (requireSecrets = true): ControlConfig => {
  const panelPassword = process.env.PANEL_PASSWORD ?? '';
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  if (requireSecrets && panelPassword.length < 8) throw new Error('PANEL_PASSWORD 至少需要 8 个字符');
  if (requireSecrets && sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少需要 32 个字符');

  const panelDomain = normalizeDomain(process.env.PANEL_DOMAIN);
  return {
    mode: requireMode(process.env.APP_MODE),
    accountsDir: path.resolve(process.env.ACCOUNTS_DIR ?? './accounts'),
    controlDir: path.resolve(process.env.CONTROL_DIR ?? './control-data'),
    coreEntry: path.resolve(process.env.CORE_ENTRY ?? path.join(compiledRoot, 'main.js')),
    webDistDir: path.resolve(process.env.WEB_DIST_DIR ?? './web-dist'),
    host: process.env.WEB_HOST ?? '127.0.0.1',
    port: requirePort(process.env.WEB_PORT),
    timeZone: process.env.TZ ?? 'Asia/Shanghai',
    panelPassword,
    sessionSecret,
    secureCookies: (process.env.SECURE_COOKIES ?? (requireMode(process.env.APP_MODE) === 'server' ? 'true' : 'false')) === 'true',
    panelDomain,
    publicBaseUrl: normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL, panelDomain),
  };
};
