import Link from 'next/link';
import { settlementAccountKey, settlementAccountLabel, type SettlementAccountOption } from '@/lib/settlements/accounts';
import { AdminStatusBadge } from '../console/AdminKit';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '../console';
import { SalesFilterField, SalesSelect, SalesGuide } from '../sales/SalesConsole';
import { PgSettlementImportControl } from '../PgSettlementImportControl';
import { PG_SETTLEMENT_PATH, pgSettlementHref, type PgSettlementFilters } from '@/lib/settlements/console';
import { formatSettlementDecimal } from '@/lib/settlements/decimal';
import { PG_SETTLEMENT_FEE_LABELS, PG_SETTLEMENT_KIND_LABELS, PG_SETTLEMENT_MATCH_LABELS, type PgSettlementReport, type PgSettlementTransaction } from '@/lib/settlements/report';
import type { SettlementMode } from '@/lib/settlements/types';
import { kstDateTimeText } from '@/lib/admin/list-export';

const AMOUNT = (value: string) => <span className="mono">{formatSettlementDecimal(value)}</span>;
const MATCH_REASON: Record<string, string> = {
  verified: '수집 시점의 결제·금액·거래 근거 일치', payment_not_found: '연결할 결제 없음', payment_not_finalized: '결제 확정 근거 없음',
  ambiguous_payment: '결제 연결을 하나로 특정할 수 없음', payment_identity_mismatch: '결제 식별 정보 불일치', unsupported_purpose: '지원하지 않는 결제 대상',
  reference_mismatch: '주문·예매 원장 불일치', amount_mismatch: '결제금액 불일치', transaction_evidence_missing: '기존 거래 근거 미기록',
  integration_binding_mismatch: '결제 연동·상점 계정 불일치', integration_binding_missing: '정기결제 연동 근거 미기록',
  ambiguous_refund: '환불 거래를 하나로 특정할 수 없음', refund_amount_mismatch: '완료 환불금액 불일치',
};
const DAILY_COLUMNS: ConsoleGridColumn[] = [
  { key: 'date', label: '기준일', width: '115px' }, { key: 'kind', label: '거래 구분', width: '90px' }, { key: 'currency', label: '통화', width: '75px' },
  { key: 'count', label: '거래수', align: 'end', width: '80px' }, { key: 'amount', label: '거래금액 원문', align: 'end', width: '145px' },
  { key: 'fee', label: '수수료 원문', align: 'end', width: '140px' }, { key: 'supply', label: '수수료 공급가', align: 'end', width: '130px' },
  { key: 'vat', label: '수수료 부가세', align: 'end', width: '130px' }, { key: 'payout', label: '지급액 원문', align: 'end', width: '150px' },
];
const TRANSACTION_COLUMNS: ConsoleGridColumn[] = [
  { key: 'order', label: '주문번호', width: '125px' }, { key: 'kind', label: '구분 / 통화', width: '100px' },
  { key: 'match', label: '수집 시점 대조', width: '190px' }, { key: 'date', label: '정산 매출일 / 지급일', width: '165px' },
  { key: 'method', label: '결제수단', width: '105px' }, { key: 'amount', label: '거래금액 원문', align: 'end', width: '145px' },
  { key: 'payout', label: '지급액 원문', align: 'end', width: '145px' }, { key: 'detail', label: '수수료·거래 상세', width: '290px' },
];
function TransactionDetails({ row }: { row: PgSettlementTransaction }) {
  return <details className="admin-pg-settlements__transaction-details"><summary>상세 보기</summary><dl>
    <div><dt>승인 시각</dt><dd>{kstDateTimeText(row.approvedAt)}</dd></div>
    {row.canceledAt ? <div><dt>취소 시각</dt><dd>{kstDateTimeText(row.canceledAt)}</dd></div> : null}
    {row.cancelAmount !== null ? <div><dt>취소금액 원문</dt><dd>{AMOUNT(row.cancelAmount)}</dd></div> : null}
    <div><dt>할부 수수료</dt><dd>{AMOUNT(row.interestFee)}</dd></div>
    {row.fees.map((fee, index) => <div key={`${fee.type}-${index}`}><dt>{PG_SETTLEMENT_FEE_LABELS[fee.type] ?? `수수료 (${fee.type})`}</dt><dd>{AMOUNT(fee.fee)}</dd></div>)}
    <div><dt>수수료 공급가</dt><dd>{AMOUNT(row.supplyAmount)}</dd></div><div><dt>수수료 부가세</dt><dd>{AMOUNT(row.vat)}</dd></div>
    <div><dt>대조 근거</dt><dd>{row.matchReason ? MATCH_REASON[row.matchReason] ?? '추가 확인 필요' : '추가 확인 필요'}</dd></div>
  </dl></details>;
}
export function PgSettlementScreen({ filters, report, connection, operationId, accounts = [] }: {
  accounts?: SettlementAccountOption[]; filters: PgSettlementFilters; report: PgSettlementReport | null;
  connection: { enabled: boolean; mode: SettlementMode | null }; operationId: string;
}) {
  const href = pgSettlementHref(filters), snapshot = report?.snapshot ?? null;
  const collectionQuery = { account: filters.account, dateType: filters.dateType, startDate: filters.startDate, endDate: filters.endDate, mode: filters.mode };
  const job = report?.jobs.find(item => item.state === 'collecting' || item.state === 'verifying') ?? report?.jobs[0] ?? null;
  const exportParams = new URLSearchParams(href.split('?')[1]);
  if (snapshot) exportParams.set('import', snapshot.id);
  exportParams.delete('page');
  const exportHref = `/api/admin/settlements/export?${exportParams}`;
  return <section className="wc-admin-kit admin-console admin-sales-console admin-pg-settlements">
    <nav className="admin-console-tabs" aria-label="정산 조회 단위">
      {([['daily', '일별 정산내역'], ['transactions', '건별 정산내역'], ['fees', '수수료 내역']] as const).map(([tab, label]) =>
        <Link key={tab} aria-current={filters.tab === tab ? 'page' : undefined} href={pgSettlementHref(filters, { tab, page: 1 })}>{label}</Link>)}
    </nav>
    <SalesGuide title="PG 원본 자료와 ICONS 결제·환불 기록을 대조합니다.">
      <p>정산 매출일·지급일은 PG가 제공한 날짜입니다. 은행 계좌의 실제 입금 완료를 확인한 내역은 아닙니다.</p>
      <p>승인과 취소, 통화를 각각 구분해 합산합니다. 취소 원문의 부호를 임의로 바꾸거나 순입금액으로 계산하지 않습니다.</p>
      <p>코페이 정산 원본 수집과 은행 입금 대사는 아직 연결되지 않았습니다. 이 화면의 자료는 토스페이먼츠 조회 결과입니다.</p>
    </SalesGuide>
    <form action={PG_SETTLEMENT_PATH} className="admin-sales-filters" method="get" key={href}>
      <input type="hidden" name="tab" value={filters.tab} />
      {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
      <div className="admin-sales-filter-rows">
        <SalesFilterField label="정산 계정" htmlFor="pg-settlement-account"><SalesSelect id="pg-settlement-account" name="account" value={filters.account ?? ''}
          options={[{ value: '', label: '계정을 선택해주세요' }, ...accounts.filter(account => account.mode === filters.mode).map(account => ({ value: settlementAccountKey(account), label: account.label }))]} /></SalesFilterField>
        <SalesFilterField label="조회기간" htmlFor="pg-settlement-date-field">
          <SalesSelect id="pg-settlement-date-field" name="dateField" value={filters.dateType} options={[{ value: 'paidOutDate', label: '정산 지급일' }, { value: 'soldDate', label: '정산 매출일' }]} />
          <div className="admin-sales-date-range"><input type="date" name="from" aria-label="조회 시작일" defaultValue={filters.startDate} required /><span aria-hidden="true">~</span><input type="date" name="to" aria-label="조회 종료일" defaultValue={filters.endDate} required /></div>
          <span className="admin-pg-settlements__muted">최대 31일</span>
        </SalesFilterField>
        <SalesFilterField label="상세조건" htmlFor="pg-settlement-query">
          <input type="search" id="pg-settlement-query" name="query" maxLength={100} defaultValue={filters.query} placeholder="ICONS 주문번호" />
          <SalesSelect name="kind" label="거래 구분" value={filters.kind} options={[{ value: 'all', label: '거래 전체' }, { value: 'approval', label: '승인' }, { value: 'cancel', label: '취소' }]} />
          <SalesSelect name="match" label="수집 시점 대조" value={filters.match} options={[{ value: 'all', label: '대조 전체' }, { value: 'matched', label: '일치' }, { value: 'unlinked', label: '미연결' }, { value: 'mismatch', label: '불일치' }]} />
        </SalesFilterField>
        <SalesFilterField label="조회 환경" htmlFor="pg-settlement-mode">
          <SalesSelect id="pg-settlement-mode" name="mode" value={filters.mode} options={[{ value: 'live', label: '실거래 자료' }, { value: 'test', label: '테스트 자료' }]} />
          <label className="admin-pg-settlements__currency">통화<input name="currency" aria-label="통화 코드" maxLength={3} pattern="[A-Z]{3}|" defaultValue={filters.currency} placeholder="전체" /></label>
          <SalesSelect name="pageSize" label="목록 수" value={String(filters.pageSize)} options={[20, 50, 100].map(size => ({ value: String(size), label: `${size}개씩 보기` }))} />
        </SalesFilterField>
      </div>
      <div className="admin-sales-filter-actions"><button type="submit">검색</button><Link href={PG_SETTLEMENT_PATH}>초기화</Link></div>
    </form>
    {filters.rangeError ? <p role="alert" className="admin-pg-settlements__notice">{filters.rangeError}</p>
      : !report ? <p role="alert" className="admin-pg-settlements__notice">정산 자료를 불러오지 못했습니다. 현재 권한과 연결 상태를 확인한 뒤 다시 조회해주세요.</p>
        : <>
          <PgSettlementImportControl key={`${filters.account}:${filters.mode}:${filters.dateType}:${filters.startDate}:${filters.endDate}`} query={collectionQuery} enabled={connection.enabled} connectedMode={connection.mode} initialJob={job} operationId={operationId} />
          <div className="admin-pg-settlements__snapshot">
            <AdminStatusBadge tone={snapshot ? 'success' : 'warning'}>{report.coverage === 'uncollected' ? '미수집' : report.coverage === 'empty' ? '수집 완료 · 0건' : '수집 완료'}</AdminStatusBadge>
            <strong>{filters.mode === 'live' ? '실거래' : '테스트'} · 토스페이먼츠{snapshot ? ` · ${settlementAccountLabel(snapshot)}` : ''}</strong>
            {snapshot ? <span>수집 완료 {kstDateTimeText(snapshot.completedAt)} · 전체 {snapshot.recordCount.toLocaleString('ko-KR')}건</span> : <span>이 기간의 완료 자료가 없습니다.</span>}
            {snapshot ? <a className="btn" href={exportHref}>엑셀 다운로드</a> : null}
            {filters.importId ? <Link href={pgSettlementHref(filters, { importId: null, page: 1 })}>최신 수집 자료 조회</Link> : null}
          </div>
          {filters.mode === 'test' ? <p className="admin-pg-settlements__muted">토스 테스트 환경은 정산 기록을 제공하지 않습니다. 실제 PG 정산 내역은 실거래 환경에서 조회합니다.</p> : null}
          {snapshot ? <>
            <p className="admin-pg-settlements__muted">현재 검색 결과 {report.pagination.total.toLocaleString('ko-KR')}건 · 금액은 통화별 원본 값이며 수수료의 소수 자릿수를 보존합니다.</p>
            {filters.tab === 'daily' ? <ConsoleGrid caption="일별 정산내역" preferencesKey="pg-settlement-daily" columns={DAILY_COLUMNS}
              emptyLabel="조건에 맞는 일별 정산 내역이 없습니다." rows={report.daily.map(row => ({ id: `${row.date}:${row.currency}:${row.kind}`, cells: [row.date, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.count.toLocaleString('ko-KR'), AMOUNT(row.amount), AMOUNT(row.feeAmount), AMOUNT(row.supplyAmount), AMOUNT(row.vat), AMOUNT(row.payOutAmount)] }))} /> : null}
            {filters.tab === 'transactions' ? <>
              <ConsoleGrid caption="건별 정산내역" preferencesKey="pg-settlement-transactions" columns={TRANSACTION_COLUMNS} emptyLabel="조건에 맞는 거래가 없습니다."
                rows={report.transactions.map(row => ({ id: row.id, cells: [
                  row.referenceId && row.purpose === 'order' ? <Link key="order" className="admin-console-grid-link" href={`/admin/sales/orders/${row.referenceId}`}>{row.orderNumber}</Link> : row.orderNumber ?? '미연결',
                  `${PG_SETTLEMENT_KIND_LABELS[row.kind]} · ${row.currency}`,
                  <span key="match"><AdminStatusBadge tone={row.matchState === 'matched' ? 'success' : 'warning'}>{PG_SETTLEMENT_MATCH_LABELS[row.matchState]}</AdminStatusBadge><small>{row.matchReason ? MATCH_REASON[row.matchReason] ?? '추가 확인 필요' : '추가 확인 필요'}</small></span>,
                  <span key="date">{row.soldDate}<small>{row.paidOutDate}</small></span>, row.method, AMOUNT(row.amount), AMOUNT(row.payOutAmount), <TransactionDetails key="details" row={row} />,
                ] }))} />
              <ConsolePagination label="건별 정산내역 페이지" page={filters.page} pageSize={filters.pageSize} total={report.pagination.total} hrefForPage={page => pgSettlementHref(filters, { page })} />
            </> : null}
            {filters.tab === 'fees' ? <ConsoleGrid caption="수수료 내역" preferencesKey="pg-settlement-fees" emptyLabel="조건에 맞는 수수료 내역이 없습니다."
              columns={[{ key: 'currency', label: '통화', width: '80px' }, { key: 'kind', label: '거래 구분', width: '100px' }, { key: 'type', label: '수수료 항목' }, { key: 'count', label: '거래수', align: 'end', width: '100px' }, { key: 'fee', label: '수수료 원문 합계', align: 'end', width: '180px' }]}
              rows={report.fees.map(row => ({ id: `${row.currency}:${row.kind}:${row.type}`, cells: [row.currency, PG_SETTLEMENT_KIND_LABELS[row.kind], PG_SETTLEMENT_FEE_LABELS[row.type] ?? `수수료 (${row.type})`, row.count.toLocaleString('ko-KR'), AMOUNT(row.fee)] }))} /> : null}
          </> : null}
          {report.jobs.length ? <details className="admin-pg-settlements__history"><summary>수집 이력 ({report.jobs.length}건)</summary><ul>{report.jobs.map(item => <li key={item.id}>
            <span>{kstDateTimeText(item.startedAt)} · {item.recordCount.toLocaleString('ko-KR')}건 · {item.state === 'complete' ? '완료' : item.state === 'failed' ? '중단' : '진행 중'}</span>
            {item.state === 'complete' ? <Link href={pgSettlementHref(filters, { importId: item.id, page: 1 })}>이 자료 조회</Link> : null}
          </li>)}</ul></details> : null}
        </>}
  </section>;
}
