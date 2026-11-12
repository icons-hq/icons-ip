import { describe, expect, it } from 'vitest';
import {
  TOSS_ALLOWED_MERCHANT_IDS,
  TOSS_ICONS_WIDGET_VARIANT_KEY,
  isTossAllowedMerchantId,
  isTossDocsPublicKey,
  isTossWidgetVariantKey,
  parseTossAdditionalMerchantIds,
  parseTossWidgetVariantKey,
  tossMerchantBindingFromEnvironment,
  tossMerchantIdsForMode,
} from './toss-config.mjs';

describe('toss-config 상점아이디(MID) 허용 목록', () => {
  /*
   * 사용자 결정(2026-11-12): 국내카드 iconsi0xvd, 해외카드 iconsi8sr4. 해외카드 MID는 허용
   * 목록·MID 대조에만 넣고 그 MID로 들어가는 결제 진입은 만들지 않는다. 알리페이는 생성 예정이라
   * env(TOSS_ADDITIONAL_MERCHANT_IDS)로 더한다.
   */
  it('라이브 MID 상수는 국내카드 iconsi0xvd와 해외카드 iconsi8sr4다', () => {
    expect(TOSS_ALLOWED_MERCHANT_IDS).toEqual(['iconsi0xvd', 'iconsi8sr4']);
  });

  /*
   * 테스트 키 결제의 Payment.mId는 라이브 MID 앞에 `t`가 붙는다(2026-10-12 결제 어드민
   * 실측: 테스트 모드 결제 UI MID tgsangwbzqu·theygrav2hj / 라이브 gsangwbzqu·heygrav2hj,
   * 공식문서 릴리즈 노트의 테스트 응답 예시 MID tvivarepublica2). 판정은 키 모드별이다.
   */
  it('키 모드별 허용 MID를 파생한다 — 라이브는 상수 그대로, 테스트는 각각 `t` 접두', () => {
    expect(tossMerchantIdsForMode('live')).toEqual(['iconsi0xvd', 'iconsi8sr4']);
    expect(tossMerchantIdsForMode('test')).toEqual(['ticonsi0xvd', 'ticonsi8sr4']);
    expect(tossMerchantIdsForMode('none')).toEqual([]);
    expect(tossMerchantIdsForMode(undefined)).toEqual([]);
  });

  it('env로 더한 MID도 같은 규칙으로 파생한다', () => {
    expect(tossMerchantIdsForMode('live', ['iconsalipy1'])).toEqual(['iconsi0xvd', 'iconsi8sr4', 'iconsalipy1']);
    expect(tossMerchantIdsForMode('test', ['iconsalipy1'])).toEqual(['ticonsi0xvd', 'ticonsi8sr4', 'ticonsalipy1']);
    expect(isTossAllowedMerchantId('iconsalipy1', 'live', ['iconsalipy1'])).toBe(true);
    expect(isTossAllowedMerchantId('ticonsalipy1', 'test', ['iconsalipy1'])).toBe(true);
    expect(isTossAllowedMerchantId('iconsalipy1', 'live')).toBe(false);
  });

  it('라이브 키는 라이브 MID만, 테스트 키는 테스트 MID만 허용한다', () => {
    for (const merchantId of ['iconsi0xvd', 'iconsi8sr4']) {
      expect(isTossAllowedMerchantId(merchantId, 'live')).toBe(true);
      expect(isTossAllowedMerchantId(`t${merchantId}`, 'live')).toBe(false);
      expect(isTossAllowedMerchantId(`t${merchantId}`, 'test')).toBe(true);
      expect(isTossAllowedMerchantId(merchantId, 'test')).toBe(false);
    }
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

  it('코드 상수는 런타임에 바꿀 수 없다 — env는 더하기만 하고 줄이지 못한다', () => {
    expect(Object.isFrozen(TOSS_ALLOWED_MERCHANT_IDS)).toBe(true);
    // 파생 목록을 고쳐도 원본 목록은 그대로다.
    tossMerchantIdsForMode('live').push('other');
    expect(tossMerchantIdsForMode('live')).toEqual(['iconsi0xvd', 'iconsi8sr4']);
  });
});

describe('toss-config 추가 MID env(TOSS_ADDITIONAL_MERCHANT_IDS)', () => {
  it('없거나 빈 값은 빈 목록이다', () => {
    expect(parseTossAdditionalMerchantIds(undefined)).toEqual([]);
    expect(parseTossAdditionalMerchantIds(null)).toEqual([]);
    expect(parseTossAdditionalMerchantIds('')).toEqual([]);
    expect(parseTossAdditionalMerchantIds('   ')).toEqual([]);
  });

  it('쉼표로 나누고 공백·중복·코드 상수에 이미 있는 MID를 걸러 낸다', () => {
    expect(parseTossAdditionalMerchantIds(' iconsalipy1, iconsi8sr4 ,iconsalipy1,CF_arikonf1 '))
      .toEqual(['iconsalipy1', 'CF_arikonf1']);
  });

  it.each([
    ['공백 낀 값', 'icons alipay'],
    ['허용 밖 문자', 'icons-alipay'],
    ['빈 항목', 'iconsalipy1,,'],
    ['15자', 'a'.repeat(15)],
    ['한 글자', 'a'],
    ['문자열 아님', 42],
  ])('형식 밖(%s)이면 null — 호출자가 설정 오류로 다룬다', (_label, value) => {
    expect(parseTossAdditionalMerchantIds(value)).toBeNull();
  });
});

describe('toss-config 결제 UI variantKey(TOSS_WIDGET_VARIANT_KEY)', () => {
  it('런북이 만들게 하는 결제 UI 이름은 ICONS다', () => {
    expect(TOSS_ICONS_WIDGET_VARIANT_KEY).toBe('ICONS');
  });

  it('없거나 빈 값은 null(바인딩 꺼짐 — 지금 동작)이다', () => {
    expect(parseTossWidgetVariantKey(undefined)).toBeNull();
    expect(parseTossWidgetVariantKey('')).toBeNull();
    expect(parseTossWidgetVariantKey('  ')).toBeNull();
  });

  it('형식 안의 값은 앞뒤 공백을 빼고 돌려준다', () => {
    expect(parseTossWidgetVariantKey('ICONS')).toBe('ICONS');
    expect(parseTossWidgetVariantKey(' ICONS ')).toBe('ICONS');
    expect(parseTossWidgetVariantKey('ICONS-2')).toBe('ICONS-2');
    expect(parseTossWidgetVariantKey('icons_review')).toBe('icons_review');
  });

  it.each([
    ['DEFAULT', 'DEFAULT'],
    ['소문자 default', 'default'],
    ['공백 낀 값', 'ICONS UI'],
    ['51자', 'A'.repeat(51)],
    ['문자열 아님', 1],
  ])('%s는 false(설정 오류)다 — DEFAULT로 바인딩하면 MID 대조가 모든 결제를 격리한다', (_label, value) => {
    expect(parseTossWidgetVariantKey(value)).toBe(false);
  });

  it('클라이언트 payload 판정은 서버가 보낼 수 있는 정확한 값만 받는다', () => {
    expect(isTossWidgetVariantKey('ICONS')).toBe(true);
    expect(isTossWidgetVariantKey(' ICONS')).toBe(false);
    expect(isTossWidgetVariantKey('DEFAULT')).toBe(false);
    expect(isTossWidgetVariantKey('')).toBe(false);
    expect(isTossWidgetVariantKey(undefined)).toBe(false);
  });
});

describe('toss-config 바인딩 판정(tossMerchantBindingFromEnvironment)', () => {
  it('env가 없으면 unbound다 — 빌드·런타임이 같은 규칙을 쓴다', () => {
    expect(tossMerchantBindingFromEnvironment({})).toEqual({ kind: 'unbound', additionalMerchantIds: [] });
    expect(tossMerchantBindingFromEnvironment(undefined)).toEqual({ kind: 'unbound', additionalMerchantIds: [] });
  });

  it('variantKey가 있으면 bound이고 추가 MID를 함께 싣는다', () => {
    expect(tossMerchantBindingFromEnvironment({
      TOSS_WIDGET_VARIANT_KEY: 'ICONS',
      TOSS_ADDITIONAL_MERCHANT_IDS: 'iconsalipy1',
    })).toEqual({ kind: 'bound', variantKey: 'ICONS', additionalMerchantIds: ['iconsalipy1'] });
  });

  it('형식 밖 값은 invalid다(이유 구분)', () => {
    expect(tossMerchantBindingFromEnvironment({ TOSS_WIDGET_VARIANT_KEY: 'DEFAULT' }))
      .toEqual({ kind: 'invalid', reason: 'variant_key' });
    expect(tossMerchantBindingFromEnvironment({
      TOSS_WIDGET_VARIANT_KEY: 'ICONS',
      TOSS_ADDITIONAL_MERCHANT_IDS: 'bad id',
    })).toEqual({ kind: 'invalid', reason: 'additional_merchant_ids' });
  });

  it('구 연동 env(NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY)는 읽지 않는다', () => {
    expect(tossMerchantBindingFromEnvironment({
      NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: 'ICONS',
    })).toEqual({ kind: 'unbound', additionalMerchantIds: [] });
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
