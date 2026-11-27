import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/pg-settlement-actions', () => ({ advancePgSettlementImportAction: vi.fn(), readPgSettlementImportAction: vi.fn(), startPgSettlementImportAction: vi.fn() }));
import { PgSettlementScreen } from './PgSettlementScreen';
import { normalizePgSettlementFilters } from '@/lib/settlements/console';
import { SETTLEMENT_FIXTURE_TRANSACTION, settlementReportFixture } from '@/lib/settlements/fixture';
import type { SettlementAccountOption } from '@/lib/settlements/accounts';
import { PG_SETTLEMENTS_HELP } from '@/lib/admin/help/pg-settlements';
const filters = normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-10-31', mode: 'test' });
const liveFilters = normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-10-31' });
const report = settlementReportFixture();
const OFF = { enabled: false, mode: null } as const;
function render(tab: 'daily' | 'transactions' | 'fees') { return renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab }} report={report} connection={OFF} operationId={report.snapshot!.operationId} />); }
const tag = (html: string, name: string) => html.match(new RegExp(`<(?:input|select)[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
describe('settlement screen', () => {
  it('separates source payout values, snapshot time, environment and actual bank deposits', () => {
    const html = render('daily');
    expect(html).toContain('일별 정산 내역'); expect(html).toContain('테스트'); expect(html).toContain('>지급액<');
    expect(html).toContain('12,684.55'); expect(html).toContain('315.45'); expect(html).toContain('가져온 시각 (KST) 2026. 10. 13. 22:05');
    expect(html).toContain('결제사 정산 연결 꺼짐');
    /* 지급액이 은행 입금이 아니라는 말은 "?" 한 곳에 있다(표 머리글은 글자만 받아 기간 합계 제목 옆에 둔다). */
    expect(html).toMatch(/<button(?=[^>]*data-admin-help="")(?=[^>]*aria-label="지급액 도움말")/);
    expect(PG_SETTLEMENTS_HELP.payout.what).toContain('은행에 실제로 들어온 금액');
    expect(html).toContain(`import=${report.snapshot!.id}`); expect(html).not.toMatch(/paymentKey|scopeHash|secretKey/);
    /* 조회 조건은 GET 폼 제출이다 — kit Button은 type이 없으면 button이 된다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>검색</);
    /* 통화는 받은 자료에 하나뿐이면 칸이 없다. 자료 구분은 테스트로 보고 있을 때만 고른다. */
    for (const name of ['account', 'dateField', 'from', 'to', 'query', 'kind', 'match', 'mode', 'pageSize']) expect(html).toContain(`name="${name}"`);
    expect(html).not.toContain('name="currency"');
  });
  it('기간 합계를 표 위에 승인·취소로 나눠 보이고 꺼진 연결은 주의 상자로 말한다', () => {
    const html = render('daily');
    const totals = html.indexOf('data-pg-settlement-totals');
    expect(totals).toBeGreaterThan(0);
    expect(totals).toBeLessThan(html.indexOf('caption class="sr-only">일별 정산 내역'));
    expect(html.slice(totals)).toContain('기간 합계');
    expect(html).toMatch(/data-admin-notice="warning"(?:(?!<\/section>)[\s\S])*결제사 정산 연결 꺼짐/);
    expect(html).toMatch(/data-tone="neutral"[^>]*>승인</);
    /* 날짜는 다른 화면과 같은 표기다. */
    expect(html).toContain('2026. 10. 14.');
    expect(html).not.toContain('>2026-10-14<');
  });
  /* 사람 눈 판정(3라운드): 노란 '연결 꺼짐' 바로 아래 초록 '가져옴'이 있어 어느 쪽을 믿어야 할지 망설였다. */
  it('연결이 꺼져 있으면 받아 둔 자료를 저장된 자료로 부르고 초록 가져옴으로 칠하지 않는다', () => {
    /* 자료 상태는 자료 줄(data-pg-settlement-snapshot)의 첫 표시가 말한다. 아래 '내가 가져온 기록'의 같은 이름과 섞이지 않게 그 줄만 본다. */
    const bar = (html: string) => html.match(/data-pg-settlement-snapshot=""[\s\S]*?<\/div>/)?.[0] ?? '';
    const off = bar(render('daily'));
    expect(off).toMatch(/data-tone="neutral"[^>]*>저장된 자료</);
    expect(off).not.toMatch(/data-tone="success"/);
    const on = bar(renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab: 'daily' }} report={report} connection={{ enabled: true, mode: 'test' }} operationId={report.snapshot!.operationId} />));
    expect(on).toMatch(/data-tone="success"[^>]*>가져옴</);
  });
  it('shows transaction evidence and expandable fee details without raw identifiers', () => {
    const html = render('transactions'); expect(html).toContain('287B949D'); expect(html).toContain('상세'); expect(html).toContain('기본 수수료');
    expect(render('fees')).toContain('수수료 합계');
    /* 비교한 이유는 표의 한 곳에만 있고 펼침에서 되풀이하지 않는다. */
    expect(html.match(/결제·환불 기록과 금액이 같습니다\./g)).toHaveLength(1);
    expect(html).toMatch(/data-tone="success"[^>]*>맞음</); expect(html).toContain('승인 시각 (KST)');
    /* 운영팀이 읽는 화면이라 '원문'·'PG'·'수집' 같은 개발 말과 내부 계정 번호는 쓰지 않는다. 표는 제목이 있는 구역 안에 둔다. */
    for (const tab of ['daily', 'transactions', 'fees'] as const) expect(render(tab)).not.toMatch(/원문|조회 환경|대조 전체|수집|\bPG\b|일치 여부|계정 [0-9a-f]{8}|정산내역/);
    expect(render('daily')).toMatch(/data-console-list=""[\s\S]*<h3[^>]*>일별 정산 내역<\/h3>/);
  });
  it('비교 결과는 세 상태 이름과 이유 한 줄로 말하고 주문이 없으면 번호 자리를 비워 둔다', () => {
    const html = renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab: 'transactions' }} connection={OFF} operationId={report.snapshot!.operationId}
      report={{ ...report, transactions: [
        { ...SETTLEMENT_FIXTURE_TRANSACTION, id: 'a', matchState: 'unlinked', matchReason: 'payment_not_found', orderNumber: null, referenceId: null, purpose: null },
        { ...SETTLEMENT_FIXTURE_TRANSACTION, id: 'b', matchState: 'mismatch', matchReason: 'amount_mismatch' },
        { ...SETTLEMENT_FIXTURE_TRANSACTION, id: 'c', matchState: 'mismatch', matchReason: 'brand_new_code' },
      ] }} />);
    expect(html).toMatch(/data-tone="warning"[^>]*>연결 안 됨</); expect(html).toContain('우리 결제 기록에서 찾지 못했습니다.');
    expect(html).toMatch(/data-tone="danger"[^>]*>다름</); expect(html).toContain('결제사 금액과 우리 결제 금액이 다릅니다.');
    expect(html).toContain('이유를 알 수 없습니다. 개발 담당자에게 알려 주세요.');
    expect(html).toMatch(/>-<\/td>|>-<\/span>|>-</); expect(html).not.toContain('미연결'); expect(html).not.toContain('payment_not_found');
    /* 조회 조건의 이름도 같다. */
    expect(tag(html, 'match')).toContain('aria-label="비교 결과"');
    expect(html).toContain('비교 결과 전체'); expect(html).toContain('>연결 안 됨</option>');
  });
  it('처음 보는 수수료 종류는 영문 코드 대신 기타 수수료로 부른다', () => {
    const odd = { ...report, fees: [{ currency: 'KRW', kind: 'approval' as const, type: 'NEW_FEE_KIND', count: 1, fee: '10' }], transactions: [{ ...SETTLEMENT_FIXTURE_TRANSACTION, fees: [{ type: 'NEW_FEE_KIND', fee: '10' }] }] };
    for (const tab of ['fees', 'transactions'] as const) {
      const html = renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab }} report={odd} connection={OFF} operationId={report.snapshot!.operationId} />);
      expect(html).toContain('기타 수수료'); expect(html).not.toContain('NEW_FEE_KIND');
    }
  });
  it('실거래 연결에서는 자료 구분을 묻지 않고 지금 값을 그대로 보낸다', () => {
    const live = renderToStaticMarkup(<PgSettlementScreen filters={{ ...liveFilters, tab: 'daily' }} report={report} connection={{ enabled: true, mode: 'live' }} operationId={report.snapshot!.operationId} />);
    expect(live).not.toContain('자료 구분'); expect(live).not.toContain('테스트 자료'); expect(live).not.toContain('토스 테스트 환경');
    expect(live).toMatch(/<input[^>]*name="mode"[^>]*value="live"|<input[^>]*value="live"[^>]*name="mode"/);
    expect(live).not.toMatch(/<select[^>]*name="mode"/);
    /* 연결이 꺼져 있어도 실거래로 보고 있으면 같다. */
    expect(renderToStaticMarkup(<PgSettlementScreen filters={{ ...liveFilters, tab: 'daily' }} report={report} connection={OFF} operationId={report.snapshot!.operationId} />)).not.toContain('자료 구분');
    /* 테스트 연결이거나 테스트 자료를 보고 있을 때만 고른다. */
    const testConnection = renderToStaticMarkup(<PgSettlementScreen filters={{ ...liveFilters, tab: 'daily' }} report={report} connection={{ enabled: true, mode: 'test' }} operationId={report.snapshot!.operationId} />);
    expect(testConnection).toContain('자료 구분'); expect(testConnection).toContain('테스트 자료');
    const viewingTest = render('daily');
    expect(viewingTest).toContain('자료 구분'); expect(viewingTest).toContain('토스 테스트 환경에는 정산 기록이 없습니다');
    expect(viewingTest).not.toMatch(/<input[^>]*type="hidden"[^>]*name="mode"/);
  });
  it('통화는 받은 자료에 있는 통화만 고르고 하나뿐이면 칸을 두지 않는다', () => {
    const usd = { ...report.totals[0], currency: 'USD' };
    const two = renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, tab: 'daily' }} report={{ ...report, totals: [report.totals[0], usd] }} connection={OFF} operationId={report.snapshot!.operationId} />);
    expect(tag(two, 'currency')).not.toBe(''); expect(two).toContain('통화 전체'); expect(two).toContain('<option value="KRW">KRW</option>'); expect(two).toContain('<option value="USD">USD</option>');
    expect(two).not.toMatch(/maxLength="3"|pattern="\[A-Z\]/);
    /* 이미 통화를 걸어 두었으면 하나뿐이어도 풀 수 있게 칸을 둔다. */
    const filtered = renderToStaticMarkup(<PgSettlementScreen filters={{ ...filters, currency: 'KRW', tab: 'daily' }} report={report} connection={OFF} operationId={report.snapshot!.operationId} />);
    expect(filtered).toContain('통화 전체'); expect(filtered).toMatch(/<option value="KRW" selected="">KRW<\/option>/);
    /* 받은 자료가 없으면(미수집·불러오기 실패) 고를 통화도 없다. */
    expect(renderToStaticMarkup(<PgSettlementScreen filters={filters} report={null} connection={OFF} operationId={report.snapshot!.operationId} />)).not.toContain('name="currency"');
  });
  it('종료일은 시작일부터 31일 안에서만 고르게 하고 정산 계정에는 내부 번호를 쓰지 않는다', () => {
    const html = render('daily');
    expect(tag(html, 'to')).toContain('min="2026-10-01"'); expect(tag(html, 'to')).toContain('max="2026-10-31"');
    const account = (accountId: string, integration: 'toss_payment' | 'toss_billing'): SettlementAccountOption => ({ accountId, integration, mode: 'test', label: `${integration} · 계정 ${accountId.slice(0, 8)}` });
    const accounts = [account('287b949d-af67-4398-b0d2-09adbd123459', 'toss_payment'), account('aaaa949d-af67-4398-b0d2-09adbd123459', 'toss_billing'), account('bbbb949d-af67-4398-b0d2-09adbd123459', 'toss_billing')];
    const withAccounts = renderToStaticMarkup(<PgSettlementScreen accounts={accounts} filters={{ ...filters, tab: 'daily' }} report={report} connection={OFF} operationId={report.snapshot!.operationId} />);
    expect(withAccounts).toContain('>일반 결제</option>'); expect(withAccounts).toContain('>정기결제 1</option>'); expect(withAccounts).toContain('>정기결제 2</option>');
    expect(withAccounts).not.toMatch(/계정 [0-9a-f]{8}/);
    expect(withAccounts).toMatch(/테스트 · 토스페이먼츠 · 일반 결제</);
  });
  it('엑셀 내려받기는 다른 목록과 같은 이름이고 설명 문단은 하나뿐이다', () => {
    const html = render('daily');
    expect(html).toContain('목록 엑셀 다운로드'); expect(html).toContain('/api/admin/settlements/export?');
    /* 메뉴설명은 날짜·비교 기준 한 문단이고, 개발 상태 안내(코페이·은행 대조 미연결)와 같은 말을 되풀이하는 글은 없다. */
    expect(html.match(/<details[^>]*data-sales-guide=""[\s\S]*?<\/details>/)?.[0].match(/<p>/g)).toHaveLength(1);
    expect(html).not.toContain('코페이'); expect(html).not.toContain('아직 연결되지 않았습니다');
    expect(html).not.toContain('은행 입금 내역 맞춰 보기'); expect(html).not.toContain('개의 페이지');
  });
  it('does not turn missing or failed source reads into a zero-amount statement or download', () => {
    const html = renderToStaticMarkup(<PgSettlementScreen filters={filters} report={{ ...report, coverage: 'uncollected', snapshot: null, transactions: [], totals: [], daily: [], fees: [], pagination: { ...report.pagination, total: 0 } }} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />);
    expect(html).toContain('아직 안 가져옴'); expect(html).not.toContain('엑셀 다운로드'); expect(html).not.toContain('12,684');
    const failed = renderToStaticMarkup(<PgSettlementScreen filters={filters} report={null} connection={{ enabled: false, mode: null }} operationId={report.snapshot!.operationId} />);
    expect(failed).toContain('정산 자료를 불러오지 못했습니다'); expect(failed).not.toContain('가져온 시각');
  });
  it('잘못된 기간은 무엇이 문제인지와 고칠 방법을 말한다', () => {
    const late = renderToStaticMarkup(<PgSettlementScreen filters={normalizePgSettlementFilters({ from: '2026-10-31', to: '2026-10-01' })} report={null} connection={OFF} operationId={report.snapshot!.operationId} />);
    expect(late).toContain('시작일이 종료일보다 늦습니다. 날짜를 바꿔 다시 검색해 주세요.');
    const long = renderToStaticMarkup(<PgSettlementScreen filters={normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-11-05' })} report={null} connection={OFF} operationId={report.snapshot!.operationId} />);
    expect(long).toContain('조회기간은 시작일부터 최대 31일입니다. 종료일을 줄여 다시 검색해 주세요.');
  });
});
