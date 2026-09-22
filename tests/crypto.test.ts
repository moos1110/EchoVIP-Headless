import { describe, expect, it } from 'vitest';
import { aesDecryptWithSeed, aesEncryptWithSeed, androidSignature, playlistDecrypt, playlistEncrypt } from '../src/utils/crypto.js';

describe('上游协议加密', () => {
  it('Token 刷新 AES 可以往返', () => {
    const encrypted = aesEncryptWithSeed({ hello: '世界' });
    expect(aesDecryptWithSeed(encrypted.encrypted, encrypted.seed)).toEqual({ hello: '世界' });
  });

  it('设备注册 AES 可以往返', () => {
    const encrypted = playlistEncrypt({ guid: 'abc' });
    expect(playlistDecrypt(encrypted.encrypted, encrypted.seed)).toEqual({ guid: 'abc' });
  });

  it('Android 签名与参数顺序无关', () => {
    expect(androidSignature({ b: 2, a: 1 })).toBe(androidSignature({ a: 1, b: 2 }));
  });
});

