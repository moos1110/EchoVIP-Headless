import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

export const LITE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`;

export const md5 = (value: string | Buffer): string => createHash('md5').update(value).digest('hex');

const aesCbcEncrypt = (plain: string, key: string, iv: string): string => {
  const cipher = createCipheriv(`aes-${Buffer.byteLength(key) * 8}-cbc`, Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex');
};

const aesCbcDecrypt = (hex: string, key: string, iv: string): string => {
  const decipher = createDecipheriv(`aes-${Buffer.byteLength(key) * 8}-cbc`, Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8');
};

export const aesEncryptFixed = (value: unknown, key: string, iv: string): string =>
  aesCbcEncrypt(typeof value === 'string' ? value : JSON.stringify(value), key, iv);

export const aesDecryptWithSeed = (hex: string, seed: string): unknown => {
  const key = md5(seed).slice(0, 32);
  const text = aesCbcDecrypt(hex, key, key.slice(-16));
  try { return JSON.parse(text) as unknown; } catch { return text; }
};

export const randomAlphaNumeric = (length: number): string => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
};

export const aesEncryptWithSeed = (value: unknown): { encrypted: string; seed: string } => {
  const seed = randomAlphaNumeric(16).toLowerCase();
  const key = md5(seed).slice(0, 32);
  return { encrypted: aesCbcEncrypt(JSON.stringify(value), key, key.slice(-16)), seed };
};

export const rsaPkcs1Hex = (value: unknown): string => publicEncrypt(
  { key: LITE_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
).toString('hex');

export const rsaRawHex = (value: unknown): string => {
  const source = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const block = Buffer.alloc(128);
  if (source.length > block.length) throw new Error('RSA 明文超过密钥长度');
  source.copy(block);
  return publicEncrypt(
    { key: LITE_PUBLIC_KEY, padding: constants.RSA_NO_PADDING },
    block,
  ).toString('hex');
};

export const playlistEncrypt = (value: unknown): { encrypted: string; seed: string } => {
  const seed = randomAlphaNumeric(6).toLowerCase();
  const digest = md5(seed);
  const hex = aesCbcEncrypt(JSON.stringify(value), digest.slice(0, 16), digest.slice(16, 32));
  return { encrypted: Buffer.from(hex, 'hex').toString('base64'), seed };
};

export const playlistDecrypt = (base64: string, seed: string): unknown => {
  const digest = md5(seed);
  const text = aesCbcDecrypt(Buffer.from(base64, 'base64').toString('hex'), digest.slice(0, 16), digest.slice(16, 32));
  try { return JSON.parse(text) as unknown; } catch { return text; }
};

export const androidSignature = (params: Record<string, unknown>, data = ''): string => {
  const salt = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
  const joined = Object.keys(params).sort().map((key) => {
    const value = params[key];
    return `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
  }).join('');
  return md5(`${salt}${joined}${data}${salt}`);
};

export const webSignature = (params: Record<string, unknown>, data = ''): string => {
  const salt = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
  const joined = Object.keys(params).map((key) => `${key}=${String(params[key])}`).sort().join('');
  return md5(`${salt}${joined}${data}${salt}`);
};

