import { describe, expect, it } from 'vitest';
import {
  adminUnpaidHref,
  normalizeAdminUnpaidFilters,
  normalizeAdminUnpaidReasonForm,
} from './unpaid';

describe('normalizeAdminUnpaidFilters', () => {
  it('검색어·페이지·선택 주문을 읽는다', () => {
    expect(normalizeAdminUnpaidFilters({ q: ' 9A3F21C0 ', page: '3', order: 'abc' })).toEqual({
      query: '9A3F21C0',
      page: 3,
      selectedOrderId: 'abc',
    });
  });

  it('망가진 페이지 값은 1로 되돌린다', () => {
    expect(normalizeAdminUnpaidFilters({ page: '-2' }).page).toBe(1);
    expect(normalizeAdminUnpaidFilters({ page: 'zzz' }).page).toBe(1);
  });

  it('선택 주문이 비면 목록만 본다', () => {
    expect(normalizeAdminUnpaidFilters({ order: '  ' }).selectedOrderId).toBeNull();
  });
});

describe('adminUnpaidHref', () => {
  it('빈 조건은 URL에 남기지 않는다', () => {
    expect(adminUnpaidHref({ query: '', page: 1, selectedOrderId: null }))
      .toBe('/admin/sales/unpaid');
  });

  it('검색·페이지·선택을 함께 유지한다', () => {
    expect(adminUnpaidHref({ query: '홍길동', page: 2, selectedOrderId: 'o1' }))
      .toBe('/admin/sales/unpaid?q=%ED%99%8D%EA%B8%B8%EB%8F%99&page=2&order=o1');
  });
});

describe('normalizeAdminUnpaidReasonForm', () => {
  function form(entries: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    return data;
  }

  it('주문과 근거를 함께 돌려준다', () => {
    const result = normalizeAdminUnpaidReasonForm(
      form({ orderId: 'o1', memo: '  국민 23,000원 홍길동 대조 완료  ' }),
      'memo',
      '메모 필요',
    );
    expect(result).toEqual({
      ok: true,
      value: { orderId: 'o1', reason: '국민 23,000원 홍길동 대조 완료' },
    });
  });

  /*
   * 공백만 200자를 넣어도 "근거를 남겼다"고 기록되면 감사 로그가 거짓말을 한다.
   * DB CHECK도 btrim 뒤 길이를 보므로 여기서 먼저 같은 판단을 한다.
   */
  it('공백뿐인 근거는 근거가 아니다', () => {
    expect(normalizeAdminUnpaidReasonForm(form({ orderId: 'o1', memo: '      ' }), 'memo', '메모 필요'))
      .toEqual({ ok: false, error: '메모 필요' });
  });

  it('주문이 없으면 근거를 보기 전에 멈춘다', () => {
    expect(normalizeAdminUnpaidReasonForm(form({ memo: '충분히 긴 메모' }), 'memo', '메모 필요'))
      .toEqual({ ok: false, error: '주문을 찾을 수 없습니다.' });
  });
});
