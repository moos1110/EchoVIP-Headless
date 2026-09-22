import type { DeviceIdentity, JsonObject } from '../types.js';
import { InvalidResponseError } from '../utils/errors.js';
import { playlistDecrypt, playlistEncrypt, rsaPkcs1Hex } from '../utils/crypto.js';
import { ApiClient } from './client.js';
import { endpoints } from './endpoints.js';

export class DeviceApi {
  constructor(private readonly client: ApiClient) {}

  async register(device: DeviceIdentity): Promise<string> {
    const payload = {
      availableRamSize: 4_983_533_568,
      availableRomSize: 48_114_719,
      availableSDSize: 48_114_717,
      basebandVer: '', batteryLevel: 100, batteryStatus: 3,
      brand: 'Redmi', buildSerial: 'unknown', device: 'marble',
      imei: device.guid, imsi: '', manufacturer: 'Xiaomi', uuid: device.guid,
      accelerometer: false, accelerometerValue: '', gravity: false, gravityValue: '',
      gyroscope: false, gyroscopeValue: '', light: false, lightValue: '',
      magnetic: false, magneticValue: '', orientation: false, orientationValue: '',
      pressure: false, pressureValue: '', step_counter: false, step_counterValue: '',
      temperature: false, temperatureValue: '',
    };
    const encrypted = playlistEncrypt(payload);
    const response = await this.client.request<Buffer>({
      method: 'POST', baseURL: endpoints.userServiceBase, url: endpoints.registerDevice,
      context: { device, auth: null },
      params: { part: 1, platid: 1, p: rsaPkcs1Hex({ aes: encrypted.seed, uid: 0, token: '' }) },
      data: encrypted.encrypted,
      responseType: 'arraybuffer',
    });
    const raw = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body as unknown as ArrayBuffer);
    const decoded = playlistDecrypt(raw.toString('base64'), encrypted.seed);
    const body = decoded && typeof decoded === 'object' ? decoded as JsonObject : {};
    const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
    const dfid = String(data.dfid ?? '');
    if (Number(body.status) !== 1 || !dfid) throw new InvalidResponseError('设备注册响应缺少 dfid', body);
    return dfid;
  }
}

