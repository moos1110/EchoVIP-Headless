import { config } from '../config.js';
import type { ApiResponse, JsonObject } from '../types.js';
import { InvalidResponseError } from '../utils/errors.js';
import { aesDecryptWithSeed, aesEncryptFixed, aesEncryptWithSeed, rsaRawHex } from '../utils/crypto.js';
import { ApiClient } from './client.js';
import { endpoints } from './endpoints.js';
import { cookieRecord, type RequestContext } from './request-context.js';

const qrUrl = (key: string): string => `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`;

export class LoginApi {
  constructor(private readonly client: ApiClient) {}

  async createQrKey(context: RequestContext): Promise<{ key: string; url: string; imageDataUrl: string }> {
    const response = await this.client.request({
      method: 'GET', baseURL: endpoints.loginBase, url: endpoints.qrKey, context,
      signature: 'web',
      params: {
        appid: 1001,
        type: 1,
        plat: 4,
        qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${config.appid}&`,
        srcappid: config.srcappid,
      },
    });
    const body = response.body as JsonObject;
    if (Number(body.status) !== 1 || Number(body.error_code ?? 0) !== 0) {
      throw new InvalidResponseError(`二维码 Key 请求失败（error_code=${String(body.error_code ?? 'unknown')}）`, body);
    }
    const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
    const key = String(data.qrcode ?? data.key ?? body.qrcode ?? body.key ?? '');
    if (!key) throw new InvalidResponseError('二维码 Key 响应缺少 key', body);
    const imageDataUrl = String(data.qrcode_img ?? '');
    return { key, url: qrUrl(key), imageDataUrl };
  }

  async checkQr(context: RequestContext, key: string): Promise<ApiResponse<JsonObject>> {
    return this.client.request<JsonObject>({
      method: 'GET', baseURL: endpoints.loginBase, url: endpoints.qrCheck, context,
      signature: 'web',
      params: {
        plat: 4, appid: config.appid, srcappid: config.srcappid,
        qrcode: key, dev: context.device.dev,
      },
    });
  }

  async refresh(context: RequestContext): Promise<ApiResponse<JsonObject>> {
    if (!context.auth) throw new InvalidResponseError('刷新 Token 时缺少登录态');
    const now = Date.now();
    const fixedKey = 'c24f74ca2820225badc01946dba4fdf7';
    const fixedIv = 'adc01946dba4fdf7';
    const p3 = aesEncryptFixed({ clienttime: Math.floor(now / 1000), token: context.auth.token }, fixedKey, fixedIv);
    const envelope = aesEncryptWithSeed({});
    const pk = rsaRawHex({ clienttime_ms: now, key: envelope.seed });
    const cookies = cookieRecord(context);
    const t2 = aesEncryptFixed(
      `${context.device.guid}|0f607264fc6318a92b9e13c65db7cd3c|${context.device.mac}|${context.device.dev}|${now}`,
      'fd14b35e3f81af3817a20ae7adae7020', '17a20ae7adae7020',
    );
    const t1 = aesEncryptFixed(`${cookies.t1 ?? ''}|${now}`, '5e4ef500e9597fe004bd09a46d8add98', '04bd09a46d8add98');
    const response = await this.client.request<JsonObject>({
      method: 'POST', baseURL: 'http://login.user.kugou.com', url: endpoints.tokenRefresh, context,
      data: {
        dfid: context.device.dfid || '-', p3, plat: 1, t1, t2,
        t3: 'MCwwLDAsMCwwLDAsMCwwLDA=', pk, params: envelope.encrypted,
        userid: context.auth.userid, clienttime_ms: now, dev: context.device.dev,
      },
    });
    const body = response.body;
    const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
    if (typeof data.secu_params === 'string') {
      const decrypted = aesDecryptWithSeed(data.secu_params, envelope.seed);
      if (decrypted && typeof decrypted === 'object') Object.assign(data, decrypted);
    }
    return response;
  }
}
