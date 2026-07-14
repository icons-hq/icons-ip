import { describe, expect, it } from 'vitest';
import {
  normalizeAdminCardForm,
  normalizeAdminEventForm,
  normalizeAdminGoodForm,
  normalizeAdminIpForm,
  normalizeAdminStockAdjustmentForm,
} from './catalog';

const context = {
  ipIds: new Set(['hwasan', 'lumen']),
  verticalKeys: new Set(['rofan', 'global']),
};

describe('admin catalog form normalization', () => {
  it('normalizes a valid IP form', () => {
    const formData = new FormData();
    formData.set('id', ' hwasan ');
    formData.set('title', ' 화산강림 ');
    formData.set('sub', '리디 · 로판');
    formData.set('verticalKey', 'rofan');
    formData.set('tagline', '매화는 다시 핀다');
    formData.set('synopsis', '화산파의 부활');
    formData.set('glyph', '화산');
    formData.set('bg', 'linear-gradient(red, blue)');
    formData.set('imagePath', 'public-media/ip/hwasan.png');
    formData.set('featured', 'on');
    formData.set('fansCount', '42');

    expect(normalizeAdminIpForm(formData, context)).toEqual({
      ok: true,
      value: {
        id: 'hwasan',
        title: '화산강림',
        sub: '리디 · 로판',
        verticalKey: 'rofan',
        tagline: '매화는 다시 핀다',
        synopsis: '화산파의 부활',
        glyph: '화산',
        bg: 'linear-gradient(red, blue)',
        imagePath: 'public-media/ip/hwasan.png',
        featured: true,
      },
    });
  });

  it('rejects missing required IP fields and unknown verticals', () => {
    const formData = new FormData();
    formData.set('id', ' ');
    formData.set('title', ' ');
    formData.set('verticalKey', 'unknown');
    formData.set('fansCount', '-1');

    expect(normalizeAdminIpForm(formData, context)).toEqual({
      ok: false,
      errors: {
        id: 'ID를 입력해주세요.',
        title: 'IP 이름을 입력해주세요.',
        verticalKey: '등록된 버티컬을 선택해주세요.',
      },
    });
  });

  it('normalizes a valid good form and rejects negative price or unknown stock', () => {
    const valid = new FormData();
    valid.set('id', 'g100');
    valid.set('ipId', 'hwasan');
    valid.set('name', '화산강림 아크릴 스탠드');
    valid.set('type', '아크릴 스탠드');
    valid.set('price', '22000');
    valid.set('badge', '신상');
    valid.set('stock', 'ok');
    valid.set('stockQty', '12');

    expect(normalizeAdminGoodForm(valid, context)).toEqual({
      ok: true,
      value: {
        id: 'g100',
        ipId: 'hwasan',
        name: '화산강림 아크릴 스탠드',
        type: '아크릴 스탠드',
        price: 22000,
        badge: '신상',
        stock: 'ok',
        bg: null,
        imagePath: null,
      },
    });

    const invalid = new FormData();
    invalid.set('id', 'g101');
    invalid.set('ipId', 'hwasan');
    invalid.set('name', '굿즈');
    invalid.set('type', '키링');
    invalid.set('price', '-1');
    invalid.set('stock', 'soon');
    invalid.set('stockQty', '-5');

    expect(normalizeAdminGoodForm(invalid, context)).toEqual({
      ok: false,
      errors: {
        price: '가격은 0 이상의 정수여야 합니다.',
        stock: '재고 상태를 선택해주세요.',
      },
    });
  });

  it('normalizes a signed stock delta and trims its required reason', () => {
    const formData = new FormData();
    formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
    formData.set('goodId', 'g100');
    formData.set('expectedStockQty', '12');
    formData.set('delta', '-3');
    formData.set('reason', '  파손 재고 보정  ');

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({
      ok: true,
      value: {
        adjustmentId: '11111111-1111-4111-8111-111111111111',
        goodId: 'g100',
        expectedStockQty: 12,
        delta: -3,
        reason: '파손 재고 보정',
      },
    });
  });

  it.each([
    { delta: '0', reason: '재고 조사', errors: { delta: '조정 수량은 0이 아닌 정수여야 합니다.' } },
    { delta: '1.5', reason: '재고 조사', errors: { delta: '조정 수량은 0이 아닌 정수여야 합니다.' } },
    { delta: '2147483648', reason: '재고 조사', errors: { delta: '조정 수량은 32비트 정수 범위여야 합니다.' } },
    { delta: '1', reason: '   ', errors: { reason: '조정 사유를 입력해주세요.' } },
    { delta: '1', reason: '가'.repeat(201), errors: { reason: '조정 사유는 200자 이하로 입력해주세요.' } },
  ])('rejects an invalid stock adjustment: $errors', ({ delta, reason, errors }) => {
    const formData = new FormData();
    formData.set('adjustmentId', '11111111-1111-4111-8111-111111111111');
    formData.set('goodId', 'g100');
    formData.set('expectedStockQty', '12');
    formData.set('delta', delta);
    formData.set('reason', reason);

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({ ok: false, errors });
  });

  it('rejects malformed idempotency and stale-stock contract fields', () => {
    const formData = new FormData();
    formData.set('adjustmentId', 'not-a-uuid');
    formData.set('goodId', 'g100');
    formData.set('expectedStockQty', '-1');
    formData.set('delta', '1');
    formData.set('reason', '입고');

    expect(normalizeAdminStockAdjustmentForm(formData)).toEqual({
      ok: false,
      errors: {
        adjustmentId: '유효한 재고 조정 요청이 아닙니다.',
        expectedStockQty: '현재 실재고를 확인해주세요.',
      },
    });
  });

  it('rejects catalog items pointing at unknown IPs and invalid card rarity', () => {
    const formData = new FormData();
    formData.set('id', 'c100');
    formData.set('ipId', 'missing');
    formData.set('name', '카드');
    formData.set('rarity', 'UR');

    expect(normalizeAdminCardForm(formData, context)).toEqual({
      ok: false,
      errors: {
        ipId: '등록된 IP를 선택해주세요.',
        rarity: '등급을 선택해주세요.',
      },
    });
  });

  it('normalizes event forms with optional IP and KST date-times', () => {
    const formData = new FormData();
    formData.set('id', 'e100');
    formData.set('ipId', '');
    formData.set('title', '합동 팝업');
    formData.set('mode', '오프라인');
    formData.set('status', '예정');
    formData.set('startsAt', '2026-07-01T10:30');
    formData.set('endsAt', '');
    formData.set('location', '성수');
    formData.set('accent', '#8B5CFF');

    expect(normalizeAdminEventForm(formData, context)).toEqual({
      ok: true,
      value: {
        id: 'e100',
        ipId: null,
        title: '합동 팝업',
        mode: '오프라인',
        status: '예정',
        startsAt: '2026-07-01T01:30:00.000Z',
        endsAt: null,
        location: '성수',
        accent: '#8B5CFF',
        bg: null,
        imagePath: null,
      },
    });
  });

  it('rejects malformed event date-times before RPC submission', () => {
    const formData = new FormData();
    formData.set('id', 'e101');
    formData.set('title', '합동 팝업');
    formData.set('mode', '오프라인');
    formData.set('status', '예정');
    formData.set('startsAt', '2026/07/01 10:30');
    formData.set('endsAt', '2026-13-01T10:30');

    expect(normalizeAdminEventForm(formData, context)).toEqual({
      ok: false,
      errors: {
        startsAt: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.',
        endsAt: '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.',
      },
    });
  });
});
