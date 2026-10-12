import { describe, expect, it } from 'vitest';
import {
  TOSS_ALLOWED_MERCHANT_IDS,
  isTossAllowedMerchantId,
  isTossDocsPublicKey,
} from './toss-config.mjs';

describe('toss-config 상점아이디(MID) 허용 목록', () => {
  it('국내 일반결제 MID iconsi0xvd만 허용한다', () => {
    expect(TOSS_ALLOWED_MERCHANT_IDS).toEqual(['iconsi0xvd']);
    expect(isTossAllowedMerchantId('iconsi0xvd')).toBe(true);
  });

  it.each([
    ['문서 공개 키 상점', 'tosspayments'],
    ['대소문자만 다른 값', 'ICONSI0XVD'],
    ['앞뒤 공백', ' iconsi0xvd'],
    ['빈 문자열', ''],
    ['누락', undefined],
    ['문자열 아님', 42],
  ])('%s는 허용하지 않는다', (_label, value) => {
    expect(isTossAllowedMerchantId(value)).toBe(false);
  });

  it('허용 목록은 런타임에 바꿀 수 없다 — 목록 추가는 코드 리뷰를 거친다', () => {
    expect(Object.isFrozen(TOSS_ALLOWED_MERCHANT_IDS)).toBe(true);
  });
});

describe('toss-config 문서 공개 테스트 키 판별', () => {
  it.each([
    // 실제 값이 아닌 같은 형태의 합성 키다.
    'test_gck_docs_000000000000000000000001',
    'test_gsk_docs_000000000000000000000001',
  ])('문서 공개 키 형태를 알아본다: %s', (key) => {
    expect(isTossDocsPublicKey(key)).toBe(true);
  });

  it.each([
    'test_gck_iconsdocs00000000000001',
    'test_gsk_iconsdocs00000000000001',
    'live_gsk_docs_lookalike000000001',
    'test_sk_docs_legacyapikey0000001',
    '',
    undefined,
  ])('상점 키·라이브 키·다른 키 계열은 문서 공개 키가 아니다: %s', (key) => {
    expect(isTossDocsPublicKey(key)).toBe(false);
  });
});
