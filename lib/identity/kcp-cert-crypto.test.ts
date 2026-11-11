import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decryptKcpCertPayload, encryptKcpCertPayload, KcpCertCryptoError } from './kcp-cert-crypto';

/* 실제 인증키·사이트코드가 아닌 테스트 전용 값이다. */
const ENC_KEY = 'unit-test-enc-key-0123456789abcdef0123456789abcdef';
const SITE_CODE = 'T0001';
const SALT = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

/** 규격을 문장 그대로 다시 적은 독립 구현 — 모듈과 같은 암호문을 내야 한다. */
function referenceEncrypt(plain: string, encKey: string, siteCode: string, salt: Buffer) {
  const key = pbkdf2Sync(Buffer.from(encKey, 'utf8'), salt, 10_000, 32, 'sha256');
  const iv = pbkdf2Sync(Buffer.from(siteCode, 'utf8'), salt, 10_000, 32, 'sha256').subarray(0, 16);
  const data = Buffer.from(plain, 'utf8');
  const pad = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

describe('encryptKcpCertPayload', () => {
  it('PBKDF2(인증키·사이트코드) + AES-256-CBC·PKCS#7 규격과 같은 암호문을 낸다', () => {
    const payload = JSON.stringify({ site_cd: SITE_CODE, ordr_idxx: 'IV0123', Ret_URL: 'https://example.test/return' });
    const encrypted = encryptKcpCertPayload(payload, ENC_KEY, SITE_CODE, SALT);

    expect(encrypted.rv).toBe(SALT.toString('base64'));
    expect(encrypted.encData).toBe(referenceEncrypt(payload, ENC_KEY, SITE_CODE, SALT));
  });

  it('블록 경계에 딱 맞는 평문도 패딩 블록 하나를 더한다', () => {
    const payload = 'x'.repeat(32);
    const encrypted = encryptKcpCertPayload(payload, ENC_KEY, SITE_CODE, SALT);
    expect(Buffer.from(encrypted.encData, 'base64')).toHaveLength(48);
    expect(encrypted.encData).toBe(referenceEncrypt(payload, ENC_KEY, SITE_CODE, SALT));
  });

  it('기본값으로 전문마다 새 솔트를 쓴다', () => {
    const first = encryptKcpCertPayload('{}', ENC_KEY, SITE_CODE);
    const second = encryptKcpCertPayload('{}', ENC_KEY, SITE_CODE);
    expect(Buffer.from(first.rv, 'base64')).toHaveLength(16);
    expect(first.rv).not.toBe(second.rv);
    expect(first.encData).not.toBe(second.encData);
  });

  it('16바이트가 아닌 솔트와 빈 키는 거절한다', () => {
    expect(() => encryptKcpCertPayload('{}', ENC_KEY, SITE_CODE, Buffer.alloc(8))).toThrow(KcpCertCryptoError);
    expect(() => encryptKcpCertPayload('{}', '', SITE_CODE, SALT)).toThrow(KcpCertCryptoError);
    expect(() => encryptKcpCertPayload('{}', ENC_KEY, '', SALT)).toThrow(KcpCertCryptoError);
  });
});

describe('decryptKcpCertPayload', () => {
  it('규격대로 암호화한 결과 데이터를 JSON 값으로 돌려준다', () => {
    const certData = { res_cd: '0000', birth_day: '19900101', DI: 'MC0GCCqGSIb3DQIJAyEA+/=', per_cert_no: '25284339349648' };
    const encData = referenceEncrypt(JSON.stringify(certData), ENC_KEY, SITE_CODE, SALT);

    expect(decryptKcpCertPayload(encData, SALT.toString('base64'), ENC_KEY, SITE_CODE)).toEqual(certData);
  });

  it('다른 인증키·사이트코드로 만든 암호문은 같은 오류 하나로 거절한다', () => {
    const encData = referenceEncrypt('{"res_cd":"0000"}', ENC_KEY, SITE_CODE, SALT);
    const rv = SALT.toString('base64');

    expect(() => decryptKcpCertPayload(encData, rv, 'another-key-0123456789abcdef', SITE_CODE)).toThrow(KcpCertCryptoError);
    expect(() => decryptKcpCertPayload(encData, rv, ENC_KEY, 'T0002')).toThrow(KcpCertCryptoError);
  });

  it('JSON이 아닌 평문은 거절한다', () => {
    const encData = referenceEncrypt('not json', ENC_KEY, SITE_CODE, SALT);
    expect(() => decryptKcpCertPayload(encData, SALT.toString('base64'), ENC_KEY, SITE_CODE)).toThrow(KcpCertCryptoError);
  });

  it('base64가 아니거나 블록 길이가 맞지 않는 값은 키를 만들기 전에 거절한다', () => {
    const rv = SALT.toString('base64');
    expect(() => decryptKcpCertPayload('%%%', rv, ENC_KEY, SITE_CODE)).toThrow(KcpCertCryptoError);
    expect(() => decryptKcpCertPayload(Buffer.alloc(15).toString('base64'), rv, ENC_KEY, SITE_CODE)).toThrow(KcpCertCryptoError);
    expect(() => decryptKcpCertPayload('', rv, ENC_KEY, SITE_CODE)).toThrow(KcpCertCryptoError);
    expect(() => decryptKcpCertPayload(Buffer.alloc(16).toString('base64'), '', ENC_KEY, SITE_CODE)).toThrow(KcpCertCryptoError);
  });

  it('암호화와 복호화가 왕복한다', () => {
    const payload = { 한글: '홍길동', nested: { ok: true } };
    const { encData, rv } = encryptKcpCertPayload(JSON.stringify(payload), ENC_KEY, SITE_CODE);
    expect(decryptKcpCertPayload(encData, rv, ENC_KEY, SITE_CODE)).toEqual(payload);
  });
});
