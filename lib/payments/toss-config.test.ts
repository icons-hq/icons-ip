import { describe, expect, it } from 'vitest';
import {
  TOSS_ALLOWED_MERCHANT_IDS,
  TOSS_WIDGET_VARIANT_KEY,
  isTossAllowedMerchantId,
  isTossDocsPublicKey,
  tossMerchantIdsForMode,
} from './toss-config.mjs';

describe('toss-config 상점아이디(MID) 허용 목록', () => {
  it('라이브 MID 목록은 국내 일반결제 MID iconsi0xvd 하나다', () => {
    expect(TOSS_ALLOWED_MERCHANT_IDS).toEqual(['iconsi0xvd']);
  });

  /*
   * 테스트 키 결제의 Payment.mId는 라이브 MID 앞에 `t`가 붙는다(2026-10-12 결제 어드민
   * 실측: 테스트 모드 결제 UI MID tgsangwbzqu·theygrav2hj / 라이브 gsangwbzqu·heygrav2hj,
   * 공식문서 248의 테스트 응답 예시 MID tvivarepublica2). 판정은 키 모드별이다.
   */
  it('키 모드별 허용 MID를 파생한다 — 라이브는 iconsi0xvd, 테스트는 ticonsi0xvd', () => {
    expect(tossMerchantIdsForMode('live')).toEqual(['iconsi0xvd']);
    expect(tossMerchantIdsForMode('test')).toEqual(['ticonsi0xvd']);
    expect(tossMerchantIdsForMode('none')).toEqual([]);
    expect(tossMerchantIdsForMode(undefined)).toEqual([]);
  });

  it('라이브 키는 iconsi0xvd만, 테스트 키는 ticonsi0xvd만 허용한다', () => {
    expect(isTossAllowedMerchantId('iconsi0xvd', 'live')).toBe(true);
    expect(isTossAllowedMerchantId('ticonsi0xvd', 'live')).toBe(false);
    expect(isTossAllowedMerchantId('ticonsi0xvd', 'test')).toBe(true);
    expect(isTossAllowedMerchantId('iconsi0xvd', 'test')).toBe(false);
  });

  it('모드를 모르면 어떤 MID도 허용하지 않는다(fail-closed)', () => {
    expect(isTossAllowedMerchantId('iconsi0xvd', undefined)).toBe(false);
    expect(isTossAllowedMerchantId('ticonsi0xvd', null)).toBe(false);
    expect(isTossAllowedMerchantId('iconsi0xvd', 'LIVE')).toBe(false);
  });

  it.each([
    ['문서 공개 키 상점', 'tosspayments'],
    ['다른 서비스의 DEFAULT 결제 UI MID', 'gsangwbzqu'],
    ['다른 서비스의 DEFAULT 결제 UI 테스트 MID', 'tgsangwbzqu'],
    ['대소문자만 다른 값', 'ICONSI0XVD'],
    ['앞뒤 공백', ' iconsi0xvd'],
    ['빈 문자열', ''],
    ['누락', undefined],
    ['문자열 아님', 42],
  ])('%s는 어느 모드에서도 허용하지 않는다', (_label, value) => {
    expect(isTossAllowedMerchantId(value, 'live')).toBe(false);
    expect(isTossAllowedMerchantId(value, 'test')).toBe(false);
  });

  it('허용 목록은 런타임에 바꿀 수 없다 — 목록 추가는 코드 리뷰를 거친다', () => {
    expect(Object.isFrozen(TOSS_ALLOWED_MERCHANT_IDS)).toBe(true);
    // 파생 목록을 고쳐도 원본 목록은 그대로다.
    tossMerchantIdsForMode('live').push('other');
    expect(tossMerchantIdsForMode('live')).toEqual(['iconsi0xvd']);
  });
});

describe('toss-config 결제 UI variantKey', () => {
  it('ICONS 전용 결제 UI를 쓴다 — 다른 서비스와 공유하는 DEFAULT로 떨어지지 않는다', () => {
    expect(TOSS_WIDGET_VARIANT_KEY).toBe('ICONS');
    expect(TOSS_WIDGET_VARIANT_KEY).not.toBe('DEFAULT');
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
