import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

/*
 * NHN KCP 휴대폰 본인확인 V2의 전문 암호 규격.
 *
 * 거래등록 요청 전문은 암호문으로 보내고(헤더 `rv`와 함께), 결과조회 응답의 인증
 * 데이터(`enc_cert_data`)는 암호문으로 받는다. 두 방향 모두 같은 규격이다.
 *   - 솔트(rv): 전문마다 새 16바이트 난수, base64
 *   - 키: PBKDF2-HMAC-SHA256(가맹점 인증키, 솔트, 10,000회) 32바이트
 *   - IV: PBKDF2-HMAC-SHA256(사이트코드, 솔트, 10,000회)의 앞 16바이트
 *   - 암호: AES-256-CBC · PKCS#7 패딩, 결과는 base64
 *
 * 규격은 KCP 상점관리자가 배포하는 V2 연동 샘플의 암호 모듈로 확인했고, 이 구현은
 * 그 샘플을 옮긴 것이 아니라 표준 primitive로 같은 규격을 따로 쓴 것이다(샘플은 KCP
 * 자산이라 공개 저장소에 두지 않는다). 무결성은 이 암호가 아니라 KCP와의 TLS가
 * 지킨다 — CBC에는 MAC이 없으므로, 응답은 우리 서버가 KCP에 직접 물은 결과만 믿는다.
 *
 * 순수 함수다. 인증키·사이트코드는 호출자가 넘기고 이 모듈은 아무것도 읽지 않는다.
 */

const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 10_000;
const KEY_BYTES = 32;
const IV_BYTES = 16;
const BLOCK_BYTES = 16;
/** 결과 데이터는 이름·생년월일·CI·DI 정도라 수 KB를 넘지 않는다. 넘으면 계약 밖이다. */
const MAX_CIPHERTEXT_BASE64_LENGTH = 64 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class KcpCertCryptoError extends Error {
  constructor() {
    super('kcp_cert_crypto_failed');
    this.name = 'KcpCertCryptoError';
  }
}

export interface KcpCertCipherText {
  /** 거래등록 요청 본문 그대로다. JSON으로 감싸지 않는다. */
  readonly encData: string;
  /** 요청 헤더 `rv`. */
  readonly rv: string;
}

function deriveCipherMaterial(encKey: string, siteCode: string, salt: Buffer) {
  if (!encKey || !siteCode || salt.length === 0) throw new KcpCertCryptoError();
  const key = pbkdf2Sync(Buffer.from(encKey, 'utf8'), salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
  const iv = pbkdf2Sync(Buffer.from(siteCode, 'utf8'), salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256')
    .subarray(0, IV_BYTES);
  return { key, iv };
}

function decodeBase64(value: string, maxLength: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || !BASE64.test(value)) {
    throw new KcpCertCryptoError();
  }
  return Buffer.from(value, 'base64');
}

/**
 * 거래등록 요청 전문을 암호화한다. 솔트는 기본적으로 매번 새로 뽑는다 — 인자는
 * 고정 벡터 테스트를 위한 seam이고 운영 코드는 넘기지 않는다.
 */
export function encryptKcpCertPayload(
  payload: string,
  encKey: string,
  siteCode: string,
  salt: Buffer = randomBytes(SALT_BYTES),
): KcpCertCipherText {
  if (typeof payload !== 'string' || salt.length !== SALT_BYTES) throw new KcpCertCryptoError();
  const { key, iv } = deriveCipherMaterial(encKey, siteCode, salt);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]);
  return { encData: encrypted.toString('base64'), rv: salt.toString('base64') };
}

/**
 * 결과조회 응답의 암호문을 복호화해 JSON 값으로 돌려준다. 패딩·UTF-8·JSON 어느 하나라도
 * 어긋나면 같은 오류다 — 실패 원인을 구분해 밖으로 흘리지 않는다.
 */
export function decryptKcpCertPayload(
  encData: string,
  rv: string,
  encKey: string,
  siteCode: string,
): unknown {
  const salt = decodeBase64(rv, 128);
  const ciphertext = decodeBase64(encData, MAX_CIPHERTEXT_BASE64_LENGTH);
  if (ciphertext.length === 0 || ciphertext.length % BLOCK_BYTES !== 0) throw new KcpCertCryptoError();
  const { key, iv } = deriveCipherMaterial(encKey, siteCode, salt);
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    return JSON.parse(text) as unknown;
  } catch {
    throw new KcpCertCryptoError();
  }
}
