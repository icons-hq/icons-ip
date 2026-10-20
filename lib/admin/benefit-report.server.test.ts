import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getBenefitIssuances, getBenefitReport } from './benefit-report.server';
import { normalizeBenefitReportFilters } from './benefit-report';
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: { couponCount: 2, useCount: 0 }, error: null }); });
describe('혜택 리포트 서버 로더', () => {
  it('KST 반열린 기간·검색·페이지를 서버집계로 전달한다', async () => {
    await getBenefitReport(normalizeBenefitReportFilters({ from: '2026-10-01', to: '2026-10-12', page: '3', q: '쿠폰', code: 'ABC' }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_benefit_report', expect.objectContaining({ p_from: '2026-09-30T15:00:00.000Z', p_to: '2026-10-12T15:00:00.000Z', p_offset: 100, p_limit: 50, p_query: '쿠폰', p_code: 'ABC' }));
  });
  it('다운로드가 10000행 초과를 조용히 잘라내지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { couponCount: 10001, useCount: 0 }, error: null });
    await expect(getBenefitReport(normalizeBenefitReportFilters({}), new Date(), true)).rejects.toThrow('benefit_export_limit');
    mocks.rpc.mockResolvedValueOnce({ data: { couponCount: 1, useCount: 10001 }, error: null });
    await expect(getBenefitReport(normalizeBenefitReportFilters({ code: 'ABC' }), new Date(), true)).rejects.toThrow('benefit_export_limit');
  });
  it('집계 오류를 0으로 바꾸지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(getBenefitReport(normalizeBenefitReportFilters({}))).rejects.toThrow('denied');
  });
});

const issuanceFilters = () => normalizeBenefitReportFilters({ code: 'ABC', detail: 'issuances', from: '2026-10-01', to: '2026-10-12', q: '50%_혜택', discount: 'fixed', segment: 'first_purchase' });
const issuanceRow = (index: number) => ({ id: `issue-${index}`, couponCode: 'ABC', issuedAt: '2026-09-30T15:00:00Z', isPaidUse: index === 0 });
const issuanceResult = (totalCount = 1, rows = [issuanceRow(0)]) => ({ totalCount, paidUseCount: 1, rows, asOf: '2026-10-12T02:00:00Z' });

describe('쿠폰 발급 상세 서버 로더', () => {
  it('선택 쿠폰과 KST 기간·조건·50개 페이지를 단일 조회로 전달한다', async () => {
    const data = issuanceResult(51, [issuanceRow(50)]);
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    await expect(getBenefitIssuances({ ...issuanceFilters(), page: 2 })).resolves.toEqual(data);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_benefit_issuances', {
      p_from: '2026-09-30T15:00:00.000Z', p_to: '2026-10-12T15:00:00.000Z', p_query: '50%_혜택',
      p_discount: 'fixed', p_segment: 'first_purchase', p_code: 'ABC', p_limit: 50, p_offset: 50,
    });
  });
  it('엑셀은 현재 페이지와 무관하게 10001개 sentinel을 요청하고 전체 발급분을 보존한다', async () => {
    const data = issuanceResult(1001, Array.from({ length: 1001 }, (_, index) => issuanceRow(index)));
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    const result = await getBenefitIssuances({ ...issuanceFilters(), page: 20 }, new Date(), true);
    expect(result.rows).toHaveLength(1001);
    expect(result.rows.at(-1)?.id).toBe('issue-1000');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_benefit_issuances', expect.objectContaining({ p_limit: 10001, p_offset: 0 }));
  });
  it('정확히 10000건인 발급 파일은 거절하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: issuanceResult(10000, Array.from({ length: 10000 }, (_, index) => issuanceRow(index))), error: null });
    await expect(getBenefitIssuances(issuanceFilters(), new Date(), true)).resolves.toMatchObject({ totalCount: 10000, paidUseCount: 1, rows: expect.any(Array) });
  });
  it('초과·잘림·중복·현재 사용 건수 불일치를 성공한 파일로 반환하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: issuanceResult(10001), error: null });
    await expect(getBenefitIssuances(issuanceFilters(), new Date(), true)).rejects.toMatchObject({ code: 'benefit_issuance_export_limit' });
    for (const data of [issuanceResult(2), issuanceResult(2, [issuanceRow(0), issuanceRow(0)]), { ...issuanceResult(), paidUseCount: 0 }]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(getBenefitIssuances(issuanceFilters(), new Date(), true)).rejects.toMatchObject({ code: 'benefit_issuance_read_failed' });
    }
  });
  it('현재 조건의 최소 응답만 투영하고 다른 쿠폰·누락 응답을 0건으로 바꾸지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...issuanceResult(), customerName: '비노출', rows: [{ ...issuanceRow(0), userId: '비노출' }] }, error: null });
    const result = await getBenefitIssuances(issuanceFilters());
    expect(Object.keys(result).sort()).toEqual(['asOf', 'paidUseCount', 'rows', 'totalCount']);
    expect(Object.keys(result.rows[0]).sort()).toEqual(['couponCode', 'id', 'isPaidUse', 'issuedAt']);
    for (const data of [null, { ...issuanceResult(), totalCount: -1 }, { ...issuanceResult(), asOf: 'invalid' }, issuanceResult(1, [{ ...issuanceRow(0), couponCode: 'OTHER' }])]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(getBenefitIssuances(issuanceFilters())).rejects.toMatchObject({ code: 'benefit_issuance_read_failed' });
    }
  });
  it('빈 결과와 범위 밖 페이지는 실제 전체 건수를 유지한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...issuanceResult(0, []), paidUseCount: 0 }, error: null });
    await expect(getBenefitIssuances(issuanceFilters())).resolves.toMatchObject({ totalCount: 0, paidUseCount: 0, rows: [] });
    mocks.rpc.mockResolvedValueOnce({ data: issuanceResult(1, []), error: null });
    await expect(getBenefitIssuances({ ...issuanceFilters(), page: 3 })).resolves.toMatchObject({ totalCount: 1, paidUseCount: 1, rows: [] });
  });
  it('잘못된 조회를 DB 전에 거부하고 권한·입력·서버 오류를 구분한다', async () => {
    for (const filters of [normalizeBenefitReportFilters({}), { ...issuanceFilters(), rangeError: 'invalid' }]) {
      await expect(getBenefitIssuances(filters)).rejects.toMatchObject({ code: 'benefit_issuance_invalid_filters' });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const [code, expected] of [['42501', 'benefit_issuance_forbidden'], ['22023', 'benefit_issuance_invalid_filters'], ['XX000', 'benefit_issuance_read_failed']]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'internal detail' } });
      await expect(getBenefitIssuances(issuanceFilters())).rejects.toMatchObject({ code: expected, message: expected });
    }
  });
});
