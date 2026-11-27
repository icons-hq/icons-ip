import { describe, expect, it } from 'vitest';
import {
  adminUnpaidAttemptStateLabel,
  adminUnpaidHref,
  adminUnpaidStateFilterOptions,
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

/* U-05·U-06: 표의 상태와 결제상태 조건은 같은 이름 표에서 나온다. 같은 상태를 두 이름으로 부르지 않고, 모르는 값을 영문 그대로 내보이지 않는다. */
describe('adminUnpaidAttemptStateLabel', () => {
  it('상태마다 운영자 이름이 있고 서로 다르다', () => {
    const labels = ['prepared', 'confirming', 'needs_review', 'unknown', null].map(adminUnpaidAttemptStateLabel);
    expect(labels).toEqual(['입금 대기', '입금 확인 처리 중', '결제 확인 필요', '결과 미확인', '결제 기록 없음']);
    expect(new Set(labels).size).toBe(labels.length);
    expect(adminUnpaidAttemptStateLabel('awaiting_deposit')).toBe('입금 대기(가상계좌)');
  });

  it('모르는 값은 영문 그대로가 아니라 확인 필요다', () => {
    expect(adminUnpaidAttemptStateLabel('declined')).toBe('확인 필요');
    expect(adminUnpaidAttemptStateLabel('brand_new_state')).toBe('확인 필요');
    /* 객체의 기본 이름(toString 등)이 상태로 읽혀 함수가 이름 자리에 들어가지 않는다. */
    expect(adminUnpaidAttemptStateLabel('toString')).toBe('확인 필요');
    expect(adminUnpaidAttemptStateLabel('constructor')).toBe('확인 필요');
  });
});

describe('adminUnpaidStateFilterOptions', () => {
  it('전체 다음에 표와 같은 이름으로 다섯 상태를 순서대로 준다', () => {
    expect(adminUnpaidStateFilterOptions()).toEqual([
      { value: '', label: '전체' },
      { value: 'prepared', label: '입금 대기' },
      { value: 'confirming', label: '입금 확인 처리 중' },
      { value: 'needs_review', label: '결제 확인 필요' },
      { value: 'unknown', label: '결과 미확인' },
      { value: 'missing', label: '결제 기록 없음' },
    ]);
  });

  it('고른 값은 모두 목록 조회가 받는 조건이다(조건에 없는 값을 고르게 하지 않는다)', () => {
    for (const { value } of adminUnpaidStateFilterOptions().filter((option) => option.value)) {
      expect(normalizeAdminUnpaidFilters({ state: value }).state, value).toBe(value);
    }
    expect(normalizeAdminUnpaidFilters({ state: '' }).state).toBeUndefined();
  });
});
