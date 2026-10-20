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
    expect(html).toContain('일별 정산내역'); expect(html).toContain('테스트'); expect(html).toContain('지급액 원문');
    expect(html).toContain('12,684.55'); expect(html).toContain('315.45'); expect(html).toContain('수집 완료 2026-10-13 22:05');
    expect(html).toContain('PG 정산 연결 꺼짐'); expect(html).toContain('실제 입금 완료를 확인한 내역은 아닙니다');
    expect(html).toContain(`import=${report.snapshot!.id}`); expect(html).not.toMatch(/paymentKey|scopeHash|secretKey/);
  });
  it('shows transaction evidence and expandable fee details without raw identifiers', () => {
    const html = render('transactions'); expect(html).toContain('287B949D'); expect(html).toContain('상세 보기'); expect(html).toContain('수집 시점의 결제'); expect(html).toContain('기본 수수료');
    expect(render('fees')).toContain('수수료 원문 합계');
  });
  it('does not turn missing or failed source reads into a zero-amount statement or download', () => {
    const html = renderToStaticMarkup(<PgSettlementScreen filters={filters} report={{ ...report, coverage: 'uncollected', snapshot: null, transactions: [], totals: [], daily: [], fees: [], pagination: { ...report.pagination, total: 0 } }} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />);
    expect(html).toContain('미수집'); expect(html).not.toContain('엑셀 다운로드'); expect(html).not.toContain('12,684');
    const failed = renderToStaticMarkup(<PgSettlementScreen filters={filters} report={null} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />);
    expect(failed).toContain('정산 자료를 불러오지 못했습니다'); expect(failed).not.toContain('수집 완료');
  });
});
