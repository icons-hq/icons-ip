import { describe, expect, it } from 'vitest';
import { benefitCohortRate, benefitReportHref, benefitTrend, normalizeBenefitReportFilters } from './benefit-report';

const metrics = { issued: 2, paidUses: 7, discountAmount: 7000, orderAmount: 35000, released: 1, cohortPaidUses: 1 };
describe('혜택 리포트 기간과 집계', () => {
  it('동일 발급 집단의 사용률을 사용하고 기간 사용량을 분자로 섞지 않는다', () => {
    expect(benefitCohortRate(metrics)).toBe('50.0%');
    expect(benefitCohortRate({ ...metrics, issued: 0 })).toBe('—');
  });
  it('한 주의 일부와 월 경계를 합산하고 빈 기간도 채운다', () => {
    const filters = normalizeBenefitReportFilters({ from: '2026-09-30', to: '2026-10-06', bucket: 'week' });
    const weekly = benefitTrend([{ date: '2026-09-30', ...metrics }, { date: '2026-10-01', ...metrics }], filters);
    expect(weekly.map(row => row.date)).toEqual(['2026-09-28', '2026-10-05']);
    expect(weekly[0]).toMatchObject({ issued: 4, paidUses: 14, discountAmount: 14000, cohortPaidUses: 2 });
    expect(weekly[1].issued).toBe(0);
    expect(benefitCohortRate(weekly[0])).toBe('50.0%');
    expect(benefitTrend([{ date: '2026-09-30', ...metrics }, { date: '2026-10-01', ...metrics }], { ...filters, bucket: 'month' })).toHaveLength(2);
  });
  it('필터·선택쿠폰·페이지를 링크에 보존하고 잘못된 날짜는 실패시킨다', () => {
    const filters = normalizeBenefitReportFilters({ q: '50% 할인', discount: 'percent', segment: 'first_purchase', code: 'test-code', page: '2', from: '2026-10-01', to: '2026-10-12', compare: 'previous' });
    const params = Object.fromEntries(new URL(benefitReportHref(filters), 'https://example.test').searchParams);
    expect(normalizeBenefitReportFilters(params)).toEqual(filters);
    expect(normalizeBenefitReportFilters({ from: '2026-02-30', to: '2026-03-01' }).rangeError).toBeTruthy();
    expect(normalizeBenefitReportFilters({ page: '-1', discount: 'other' })).toMatchObject({ page: 1, discount: 'all' });
  });
  it('공유 통계에 추가한 전년 모드는 혜택 리포트의 직전 비교 계약을 바꾸지 않는다', () => {
    expect(normalizeBenefitReportFilters({ compare: 'previous' })).toMatchObject({ compare: true, comparisonMode: 'previous' });
    const unsupported = normalizeBenefitReportFilters({ compare: 'year' });
    expect(unsupported).toMatchObject({ compare: false, comparisonMode: 'none' });
    expect(benefitReportHref(unsupported)).not.toContain('compare=year');
  });
  it('기존 상세는 사용 이력을 유지하고 발급 상세 링크는 선택쿠폰과 전체 조건을 보존한다', () => {
    expect(normalizeBenefitReportFilters({ code: 'ABC' }).detail).toBe('uses');
    expect(normalizeBenefitReportFilters({ detail: 'issuances' }).detail).toBe('uses');
    expect(normalizeBenefitReportFilters({ code: 'ABC', detail: 'invalid' }).detail).toBe('uses');
    const filters = normalizeBenefitReportFilters({ code: ' abc ', detail: 'issuances', page: '2', q: '50%_쿠폰', discount: 'percent', segment: 'repeat_purchase', from: '2026-10-01', to: '2026-10-12', bucket: 'month', compare: 'previous' });
    const href = benefitReportHref(filters, '/api/admin/benefit-workbook');
    expect(normalizeBenefitReportFilters(Object.fromEntries(new URL(href, 'https://example.test').searchParams))).toEqual(filters);
    expect(benefitReportHref({ ...filters, code: '', page: 1 })).not.toMatch(/detail=|code=|page=/);
    expect(benefitReportHref({ ...filters, detail: 'uses', page: 1 })).not.toMatch(/detail=|page=/);
  });
});
