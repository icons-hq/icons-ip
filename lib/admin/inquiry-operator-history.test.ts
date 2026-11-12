import { describe, expect, it } from 'vitest';
import { inquiryOperatorHistoryHref, normalizeInquiryOperatorHistoryFilters, parseInquiryOperatorHistory } from './inquiry-operator-history';

const NOW = new Date('2026-11-12T03:00:00Z');
const OPERATOR = 'a1050000-0000-4000-8000-000000000004';
const summary = (extra: Record<string, unknown> = {}) => ({ operatorId: OPERATOR, name: '상담원 가', managerRole: 'deputy', answers: 2, closes: 1,
  reassignments: 0, inquiries: 2, lastAt: '2026-11-12T02:00:00.123+00:00', ...extra });
const event = (id: string, extra: Record<string, unknown> = {}) => ({ id, at: '2026-11-12T02:00:00+00:00', kind: 'answered',
  inquiryId: 'a1050000-0000-4000-8000-000000000101', reference: 12, title: '배송 문의', status: 'answered', fromName: null, toName: null, ...extra });

describe('운영자별 처리 이력 조회 조건(1014-105)', () => {
  it('기본은 오늘 포함 최근 1개월(한국 날짜)이다', () => {
    expect(normalizeInquiryOperatorHistoryFilters({}, NOW)).toEqual({ from: '2026-10-12', to: '2026-11-12', operator: null, page: 1, rangeAdjusted: false, periodChosen: false });
    /* 처리 목록 링크는 기본 기간도 주소에 싣는다 — 기본 기간이면 접어 둔 조회 조건을 펼치지 않는다. */
    expect(normalizeInquiryOperatorHistoryFilters({ from: '2026-10-12', to: '2026-11-12', operator: OPERATOR }, NOW)).toMatchObject({ periodChosen: false, rangeAdjusted: false });
  });
  it('주소의 기간·운영자·페이지를 검증해 받는다', () => {
    expect(normalizeInquiryOperatorHistoryFilters({ from: '2026-01-01', to: '2026-03-31', operator: OPERATOR.toUpperCase(), page: '3' }, NOW))
      .toEqual({ from: '2026-01-01', to: '2026-03-31', operator: OPERATOR, page: 3, rangeAdjusted: false, periodChosen: true });
    expect(normalizeInquiryOperatorHistoryFilters({ operator: 'x', page: '-1' }, NOW)).toMatchObject({ operator: null, page: 1 });
  });
  it('잘못된 날짜·뒤집힌 기간·1년(366일) 초과는 최근 1개월로 바꾸고 화면이 알리게 한다', () => {
    for (const range of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-03-02', to: '2026-03-01' }, { from: '2025-01-01', to: '2026-01-03' }, { from: '2026-01-01' }]) {
      expect(normalizeInquiryOperatorHistoryFilters(range, NOW), JSON.stringify(range)).toMatchObject({ from: '2026-10-12', to: '2026-11-12', rangeAdjusted: true });
    }
    expect(normalizeInquiryOperatorHistoryFilters({ from: '2025-11-12', to: '2026-11-13' }, NOW)).toMatchObject({ from: '2025-11-12', rangeAdjusted: false });
  });
  it('주소는 기간을 늘 싣고, 페이지는 처리 목록을 볼 때만 싣는다', () => {
    const filters = normalizeInquiryOperatorHistoryFilters({}, NOW);
    expect(inquiryOperatorHistoryHref(filters)).toBe('/admin/cs/operator-history?from=2026-10-12&to=2026-11-12');
    expect(inquiryOperatorHistoryHref(filters, { operator: OPERATOR, page: 2 })).toBe(`/admin/cs/operator-history?from=2026-10-12&to=2026-11-12&operator=${OPERATOR}&page=2`);
    expect(inquiryOperatorHistoryHref({ ...filters, page: 4 })).not.toContain('page=');
  });
});

describe('운영자별 처리 이력 응답 계약', () => {
  it('집계와 처리 목록을 읽는다', () => {
    const parsed = parseInquiryOperatorHistory({ from: '2026-10-12', to: '2026-11-12', operators: [summary()],
      detail: { operatorId: OPERATOR, name: '상담원 가', page: 1, pageSize: 50, total: 2, items: [event('1'), event('2', { kind: 'reassigned', fromName: '상담원 가', toName: null, inquiryId: null, reference: null, title: null, status: null })] } });
    expect(parsed?.operators[0]).toMatchObject({ answers: 2, managerRole: 'deputy' });
    expect(parsed?.detail?.items.map(item => item.kind)).toEqual(['answered', 'reassigned']);
    expect(parseInquiryOperatorHistory({ from: '2026-10-12', to: '2026-11-12', operators: [summary({ managerRole: null })], detail: null })?.detail).toBeNull();
  });
  it('계약과 다른 응답은 빈 목록이 아니라 읽기 실패다', () => {
    const base = { from: '2026-10-12', to: '2026-11-12', operators: [summary()], detail: null };
    expect(parseInquiryOperatorHistory(base)).not.toBeNull();
    expect(parseInquiryOperatorHistory({ ...base, operators: [summary(), summary()] })).toBeNull();
    expect(parseInquiryOperatorHistory({ ...base, operators: [summary({ managerRole: 'boss' })] })).toBeNull();
    expect(parseInquiryOperatorHistory({ ...base, operators: [summary({ answers: 0, closes: 0, reassignments: 0 })] })).toBeNull();
    expect(parseInquiryOperatorHistory({ ...base, from: '2026-13-01' })).toBeNull();
    expect(parseInquiryOperatorHistory({ ...base, detail: { operatorId: OPERATOR, name: '상담원 가', page: 1, pageSize: 50, total: 0, items: [event('1')] } })).toBeNull();
    expect(parseInquiryOperatorHistory({ ...base, detail: { operatorId: OPERATOR, name: '상담원 가', page: 1, pageSize: 50, total: 1, items: [event('1', { kind: 'viewed' })] } })).toBeNull();
  });
});
