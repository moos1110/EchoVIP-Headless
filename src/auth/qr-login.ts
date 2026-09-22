import qrcode from 'qrcode-terminal';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { AuthState, DeviceIdentity, JsonObject } from '../types.js';
import { ApiError, InvalidResponseError } from '../utils/errors.js';
import { nowIso } from '../utils/date.js';
import { sleep } from '../utils/sleep.js';
import { authStore } from '../storage/stores.js';
import { LoginApi } from '../api/login.js';

const qrStatus = (body: JsonObject): number => {
  const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
  return Number(data.status ?? body.status ?? -1);
};

export class QrLoginService {
  constructor(private readonly api: LoginApi) {}

  async login(device: DeviceIdentity, force = false): Promise<AuthState> {
    const existing = await authStore.read();
    if (existing && !force) return existing;
    const context = { device, auth: null };
    const qr = await this.api.createQrKey(context);
    const qrFile = path.join(config.dataDir, 'login-qr.png');
    const imageMatch = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(qr.imageDataUrl);
    if (imageMatch?.[1]) {
      await writeFile(qrFile, Buffer.from(imageMatch[1], 'base64'));
    }
    console.log('\n请使用酷狗概念版扫描二维码并确认登录：\n');
    qrcode.generate(qr.url, { small: true });
    console.log(`\n二维码链接：${qr.url}\n`);
    if (imageMatch?.[1]) console.log(`二维码图片：${qrFile}\n`);
    let lastStatus = -1;
    const deadline = Date.now() + 180_000;
    try {
      while (Date.now() < deadline) {
        const response = await this.api.checkQr(context, qr.key);
        const body = response.body;
        const status = qrStatus(body);
        if (status !== lastStatus) {
          if (status === 1) console.log('等待扫码...');
          if (status === 2) console.log('✅ 已扫码，等待手机确认...');
          lastStatus = status;
        }
        if (status === 0) throw new ApiError('二维码已过期，请重新执行 login');
        if (status === 4) {
          const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
          const token = String(data.token ?? response.cookies.token ?? '');
          const userid = String(data.userid ?? response.cookies.userid ?? '');
          if (!token || !userid || userid === '0') throw new InvalidResponseError('扫码成功响应缺少 token 或 userid', body);
          const now = nowIso();
          const auth: AuthState = {
            version: 1, token, userid, loginMethod: 'qr', createdAt: now,
            updatedAt: now, lastValidatedAt: null, lastRefreshAt: null,
          };
          await authStore.write(auth);
          return auth;
        }
        await sleep(3_000);
      }
      throw new ApiError('二维码登录超时，请重新执行 login');
    } finally {
      if (imageMatch?.[1]) await rm(qrFile, { force: true });
    }
  }
}
