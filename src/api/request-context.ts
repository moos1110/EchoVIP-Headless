import { config } from '../config.js';
import type { AuthState, DeviceIdentity } from '../types.js';

export interface RequestContext {
  device: DeviceIdentity;
  auth: AuthState | null;
}

export const defaultParams = (context: RequestContext): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    dfid: context.device.dfid || '-',
    mid: context.device.mid,
    uuid: '-',
    appid: config.appid,
    clientver: config.clientver,
    clienttime: Math.floor(Date.now() / 1000),
  };
  if (context.auth?.token) params.token = context.auth.token;
  if (context.auth?.userid) params.userid = context.auth.userid;
  return params;
};

export const cookieRecord = (context: RequestContext): Record<string, string> => ({
  dfid: context.device.dfid || '-',
  KUGOU_API_MID: context.device.mid,
  KUGOU_API_GUID: context.device.guid,
  KUGOU_API_DEV: context.device.dev,
  KUGOU_API_MAC: context.device.mac,
  KUGOU_API_WEBGL: context.device.webgl,
  ...(context.auth?.token ? { token: context.auth.token, userid: context.auth.userid } : {}),
  ...(context.auth?.t1 ? { t1: context.auth.t1 } : {}),
});

