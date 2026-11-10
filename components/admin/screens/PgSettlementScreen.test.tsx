import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/pg-settlement-actions', () => ({ advancePgSettlementImportAction: vi.fn(), readPgSettlementImportAction: vi.fn(), startPgSettlementImportAction: vi.fn() }));
import { PgSettlementScreen } from './PgSettlementScreen';
import { normalizePgSettlementFilters } from '@/lib/settlements/console';
import { settlementReportFixture } from '@/lib/settlements/fixture';
const filters = normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-10-31', mode: 'test' });
const report = settlementReportFixture();
function render(tab: 'daily' | 'transactions' | 'fees') { return renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab }} report={report} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />); }
describe('settlement screen', () => {
  it('separates source payout values, snapshot time, environment and actual bank deposits', () => {
    const html = render('daily');
    expect(html).toContain('일별 정산내역'); expect(html).toContain('테스트'); expect(html).toContain('>지급액<');
    expect(html).toContain('12,684.55'); expect(html).toContain('315.45'); expect(html).toContain('수집 완료 2026. 10. 13. 22:05');
    expect(html).toContain('결제사 정산 연결 꺼짐'); expect(html).toContain('실제 입금 완료를 확인한 내역은 아닙니다');
    expect(html).toContain(`import=${report.snapshot!.id}`); expect(html).not.toMatch(/paymentKey|scopeHash|secretKey/);
    /* 조회 조건은 GET 폼 제출이다 — kit Button은 type이 없으면 button이 된다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>검색</);
    for (const name of ['account', 'dateField', 'from', 'to', 'query', 'kind', 'match', 'mode', 'currency', 'pageSize']) expect(html).toContain(`name="${name}"`);
  });
  it('기간 합계를 표 위에 승인·취소로 나눠 보이고 꺼진 연결은 주의 상자로 말한다', () => {
    const html = render('daily');
    const totals = html.indexOf('data-pg-settlement-totals');
    expect(totals).toBeGreaterThan(0);
    expect(totals).toBeLessThan(html.indexOf('caption class="sr-only">일별 정산내역'));
    expect(html.slice(totals)).toContain('기간 합계');
    expect(html).toMatch(/data-admin-notice="warning"(?:(?!<\/section>)[\s\S])*결제사 정산 연결 꺼짐/);
    expect(html).toMatch(/data-tone="neutral"[^>]*>승인</);
    /* 날짜는 다른 화면과 같은 표기다. */
    expect(html).toContain('2026. 10. 14.');
    expect(html).not.toContain('>2026-10-14<');
  });
  /* 사람 눈 판정(3라운드): 노란 '연결 꺼짐' 바로 아래 초록 '수집 완료'가 있어 어느 쪽을 믿어야 할지 망설였다. */
  it('연결이 꺼져 있으면 받아 둔 자료를 저장된 자료로 부르고 초록 완료로 칠하지 않는다', () => {
    const off = render('daily');
    expect(off).toMatch(/data-tone="neutral"[^>]*>저장된 자료</);
    expect(off).not.toMatch(/data-tone="success"[^>]*>수집 완료</);
    const on = renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab: 'daily' }} report={report} connection={{ enabled: true, mode: 'test' }} operationId={report.snapshot!.operationId} />);
    expect(on).toMatch(/data-tone="success"[^>]*>수집 완료</);
  });
  it('shows transaction evidence and expandable fee details without raw identifiers', () => {
    const html = render('transactions'); expect(html).toContain('287B949D'); expect(html).toContain('상세 보기'); expect(html).toContain('수집 시점의 결제'); expect(html).toContain('기본 수수료');
    expect(render('fees')).toContain('수수료 합계');
    /* 운영팀이 읽는 화면이라 '원문'·'PG' 같은 개발 말은 쓰지 않는다. 표는 제목이 있는 구역 안에 둔다. */
    for (const tab of ['daily', 'transactions', 'fees'] as const) expect(render(tab)).not.toMatch(/원문|조회 환경|대조 전체/);
    expect(render('daily')).toMatch(/data-console-list=""[\s\S]*<h3[^>]*>일별 정산내역<\/h3>/);
  });
  it('does not turn missing or failed source reads into a zero-amount statement or download', () => {
    const html = renderToStaticMarkup(<PgSettlementScreen filters={filters} report={{ ...report, coverage: 'uncollected', snapshot: null, transactions: [], totals: [], daily: [], fees: [], pagination: { ...report.pagination, total: 0 } }} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />);
    expect(html).toContain('미수집'); expect(html).not.toContain('엑셀 다운로드'); expect(html).not.toContain('12,684');
    const failed = renderToStaticMarkup(<PgSettlementScreen filters={filters} report={null} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />);
    expect(failed).toContain('정산 자료를 불러오지 못했습니다'); expect(failed).not.toContain('수집 완료');
  });
});
