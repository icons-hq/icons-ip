import Link from 'next/link';
import { settlementAccountKey, settlementAccountLabel, type SettlementAccountOption } from '@/lib/settlements/accounts';
import { AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';
import { ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '../console';
import { SalesFilterField, SalesSelect, SalesGuide, formatSalesDay } from '../sales/SalesConsole';
import { PgSettlementImportControl } from '../PgSettlementImportControl';
import { PG_SETTLEMENT_PATH, pgSettlementHref, type PgSettlementFilters } from '@/lib/settlements/console';
import { formatSettlementDecimal } from '@/lib/settlements/decimal';
import { PG_SETTLEMENT_FEE_LABELS, PG_SETTLEMENT_KIND_LABELS, PG_SETTLEMENT_MATCH_LABELS, type PgSettlementKind, type PgSettlementReport, type PgSettlementTransaction } from '@/lib/settlements/report';
import type { SettlementMode } from '@/lib/settlements/types';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const AMOUNT = (value: string) => <span className="tabular-nums">{formatSettlementDecimal(value)}</span>;
const STRONG_AMOUNT = (value: string) => <span className="font-semibold tabular-nums">{formatSettlementDecimal(value)}</span>;
/* 승인과 취소를 글자가 아니라 표시로도 구분한다 — 취소 줄이 승인 줄에 묻히지 않게 한다. */
const KIND_BADGE = (kind: PgSettlementKind) => <AdminStatusBadge tone={statusTone('pgSettlementKind', kind)}>{PG_SETTLEMENT_KIND_LABELS[kind]}</AdminStatusBadge>;
/* PG 정산 대조(템플릿 룩, ADR-0028). 조회 조건 카드·건수·표는 판매관리 공용 조각과 같은 모양이다. */
const TAB_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
const DETAIL_ROW = 'grid grid-cols-[minmax(5.3rem,1fr)_minmax(6.25rem,1.4fr)] gap-2.5';
const DETAIL_TERM = 'text-muted-foreground';
const DETAIL_VALUE = 'min-w-0 wrap-anywhere';
const NOTE = 'text-xs leading-relaxed text-muted-foreground';
const TABLE_TITLE = 'text-base font-semibold text-foreground';
const MATCH_REASON: Record<string, string> = {
  verified: '수집 시점의 결제·금액·거래 근거 일치', payment_not_found: '연결할 결제 없음', payment_not_finalized: '결제 확정 근거 없음',
  ambiguous_payment: '결제 연결을 하나로 특정할 수 없음', payment_identity_mismatch: '결제 식별 정보 불일치', unsupported_purpose: '지원하지 않는 결제 대상',
  reference_mismatch: '주문·예매 원장 불일치', amount_mismatch: '결제금액 불일치', transaction_evidence_missing: '기존 거래 근거 미기록',
  integration_binding_mismatch: '결제 연동·상점 계정 불일치', integration_binding_missing: '정기결제 연동 근거 미기록',
  ambiguous_refund: '환불 거래를 하나로 특정할 수 없음', refund_amount_mismatch: '완료 환불금액 불일치',
};
const DAILY_COLUMNS: ConsoleGridColumn[] = [
  { key: 'date', label: '기준일', width: '115px' }, { key: 'kind', label: '거래 구분', width: '90px' }, { key: 'currency', label: '통화', width: '75px' },
  { key: 'count', label: '거래수', align: 'end', width: '80px' }, { key: 'amount', label: '거래금액', align: 'end', width: '145px' },
  { key: 'fee', label: '수수료', align: 'end', width: '140px' }, { key: 'supply', label: '수수료 공급가', align: 'end', width: '130px' },
  { key: 'vat', label: '수수료 부가세', align: 'end', width: '130px' }, { key: 'payout', label: '지급액', align: 'end', width: '150px' },
];
/* 1440 화면(표 폭 약 1,100px)에 금액 열까지 들어오게 나눈다. 수수료 상세는 펼쳐서 보므로 접힌 폭만 잡는다. */
const TRANSACTION_COLUMNS: ConsoleGridColumn[] = [
  { key: 'order', label: '주문번호', width: '170px' }, { key: 'kind', label: '구분 / 통화', width: '92px' },
  { key: 'match', label: '결제 기록 일치', width: '168px' }, { key: 'date', label: '정산 매출일 / 지급일', width: '132px' },
  { key: 'method', label: '결제수단', width: '84px' }, { key: 'amount', label: '거래금액', align: 'end', width: '116px' },
  { key: 'payout', label: '지급액', align: 'end', width: '116px' }, { key: 'detail', label: '수수료·거래 상세', width: '220px' },
];
const TOTAL_COLUMNS: ConsoleGridColumn[] = [
  { key: 'kind', label: '거래 구분', width: '100px' }, { key: 'currency', label: '통화', width: '80px' }, { key: 'count', label: '거래수', align: 'end', width: '90px' },
  { key: 'amount', label: '거래금액', align: 'end' }, { key: 'fee', label: '수수료', align: 'end' }, { key: 'payout', label: '지급액', align: 'end' },
];
function TransactionDetails({ row }: { row: PgSettlementTransaction }) {
  return <details className="min-w-50 text-xs"><summary className="cursor-pointer underline-offset-4 hover:underline">상세</summary><dl className="mt-3 grid gap-2">
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>승인 시각</dt><dd className={DETAIL_VALUE}>{formatOrderDateTime(row.approvedAt)}</dd></div>
    {row.canceledAt ? <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>취소 시각</dt><dd className={DETAIL_VALUE}>{formatOrderDateTime(row.canceledAt)}</dd></div> : null}
    {row.cancelAmount !== null ? <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>취소금액</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.cancelAmount)}</dd></div> : null}
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>할부 수수료</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.interestFee)}</dd></div>
    {row.fees.map((fee, index) => <div className={DETAIL_ROW} key={`${fee.type}-${index}`}><dt className={DETAIL_TERM}>{PG_SETTLEMENT_FEE_LABELS[fee.type] ?? `수수료 (${fee.type})`}</dt><dd className={DETAIL_VALUE}>{AMOUNT(fee.fee)}</dd></div>)}
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>수수료 공급가</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.supplyAmount)}</dd></div><div className={DETAIL_ROW}><dt className={DETAIL_TERM}>수수료 부가세</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.vat)}</dd></div>
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>일치 여부 근거</dt><dd className={DETAIL_VALUE}>{row.matchReason ? MATCH_REASON[row.matchReason] ?? '추가 확인 필요' : '추가 확인 필요'}</dd></div>
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
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-pg-settlements="">
    {/* 조회 단위와 메뉴설명을 한 줄에 두어 합계와 표가 첫 화면에 더 들어오게 한다. */}
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <nav className="inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-0.5" aria-label="정산 조회 단위">
        {([['daily', '일별 정산내역'], ['transactions', '건별 정산내역'], ['fees', '수수료 내역']] as const).map(([tab, label]) =>
          <Link className={TAB_CLASS} key={tab} aria-current={filters.tab === tab ? 'page' : undefined} href={pgSettlementHref(filters, { tab, page: 1 })}>{label}</Link>)}
      </nav>
      <div className="min-w-0 flex-1 basis-80">
        <SalesGuide title="결제사(토스페이먼츠) 정산 자료와 ICONS 결제·환불 기록을 맞춰 봅니다.">
          <p>정산 매출일·지급일은 결제사가 제공한 날짜입니다. 은행 계좌의 실제 입금 완료를 확인한 내역은 아닙니다.</p>
          <p>승인과 취소, 통화를 각각 구분해 합산합니다. 취소 금액의 부호를 임의로 바꾸거나 순입금액으로 계산하지 않습니다.</p>
          <p>코페이 정산 자료 수집과 은행 입금 대사는 아직 연결되지 않았습니다. 이 화면의 자료는 토스페이먼츠 조회 결과입니다.</p>
        </SalesGuide>
      </div>
    </div>
    <form action={PG_SETTLEMENT_PATH} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground print:hidden" data-sales-filters="" method="get" key={href}>
      <input type="hidden" name="tab" value={filters.tab} />
      {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <SalesFilterField label="정산 계정" htmlFor="pg-settlement-account"><SalesSelect id="pg-settlement-account" name="account" value={filters.account ?? ''}
          options={[{ value: '', label: '계정을 선택해주세요' }, ...accounts.filter(account => account.mode === filters.mode).map(account => ({ value: settlementAccountKey(account), label: account.label }))]} /></SalesFilterField>
        <SalesFilterField label="조회기간" htmlFor="pg-settlement-date-field">
          <SalesSelect id="pg-settlement-date-field" name="dateField" value={filters.dateType} options={[{ value: 'paidOutDate', label: '정산 지급일' }, { value: 'soldDate', label: '정산 매출일' }]} />
          <div className="flex flex-wrap items-center gap-1.5"><Input className="w-36" type="date" name="from" aria-label="조회 시작일" defaultValue={filters.startDate} required /><span aria-hidden="true" className="text-muted-foreground">~</span><Input className="w-36" type="date" name="to" aria-label="조회 종료일" defaultValue={filters.endDate} required /></div>
          <span className={NOTE}>최대 31일</span>
        </SalesFilterField>
        <SalesFilterField label="상세조건" htmlFor="pg-settlement-query">
          <Input className="w-60 max-w-full" type="search" id="pg-settlement-query" name="query" maxLength={100} defaultValue={filters.query} placeholder="ICONS 주문번호" />
          <SalesSelect name="kind" label="거래 구분" value={filters.kind} options={[{ value: 'all', label: '거래 전체' }, { value: 'approval', label: '승인' }, { value: 'cancel', label: '취소' }]} />
          <SalesSelect name="match" label="결제 기록 일치" value={filters.match} options={[{ value: 'all', label: '일치 여부 전체' }, { value: 'matched', label: '일치' }, { value: 'unlinked', label: '미연결' }, { value: 'mismatch', label: '불일치' }]} />
        </SalesFilterField>
        <SalesFilterField label="자료 구분" htmlFor="pg-settlement-mode">
          <SalesSelect id="pg-settlement-mode" name="mode" value={filters.mode} options={[{ value: 'live', label: '실거래 자료' }, { value: 'test', label: '테스트 자료' }]} />
          <label className="flex items-center gap-2">통화<Input className="w-20" name="currency" aria-label="통화 코드" maxLength={3} pattern="[A-Z]{3}|" defaultValue={filters.currency} placeholder="전체" /></label>
          <SalesSelect name="pageSize" label="목록 수" value={String(filters.pageSize)} options={[20, 50, 100].map(size => ({ value: String(size), label: `${size}개씩 보기` }))} />
        </SalesFilterField>
        {/* 조회 버튼을 입력과 같은 줄 끝에 둔다 — 버튼만의 줄이 처리할 목록을 한 줄씩 밀어낸다. */}
        <div className="ml-auto flex items-center gap-2 self-end"><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={PG_SETTLEMENT_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
      </div>
    </form>
    {filters.rangeError ? <Alert variant="destructive"><AlertDescription className="text-destructive">{filters.rangeError}</AlertDescription></Alert>
      : !report ? <Alert variant="destructive"><AlertDescription className="text-destructive">정산 자료를 불러오지 못했습니다. 현재 권한과 연결 상태를 확인한 뒤 다시 조회해주세요.</AlertDescription></Alert>
        : <>
          <PgSettlementImportControl key={`${filters.account}:${filters.mode}:${filters.dateType}:${filters.startDate}:${filters.endDate}`} query={collectionQuery} enabled={connection.enabled} connectedMode={connection.mode} initialJob={job} operationId={operationId} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-card-foreground" data-pg-settlement-snapshot="">
            {/* 연결이 꺼져 있으면 지금 수집이 끝난 게 아니라 전에 받아 둔 자료다. 바로 위 주의 상자와 부딪히지 않게 초록 '완료'로 부르지 않는다. */}
            <AdminStatusBadge tone={!snapshot ? 'warning' : connection.enabled ? 'success' : 'neutral'}>{report.coverage === 'uncollected' ? '미수집' : `${connection.enabled ? '수집 완료' : '저장된 자료'}${report.coverage === 'empty' ? ' · 0건' : ''}`}</AdminStatusBadge>
            <strong className="font-medium">{filters.mode === 'live' ? '실거래' : '테스트'} · 토스페이먼츠{snapshot ? ` · ${settlementAccountLabel(snapshot)}` : ''}</strong>
            {snapshot ? <span className="text-muted-foreground tabular-nums">수집 완료 {snapshot.completedAt ? formatOrderDateTime(snapshot.completedAt) : ''} · 전체 {snapshot.recordCount.toLocaleString('ko-KR')}건</span> : <span className="text-muted-foreground">이 기간의 완료 자료가 없습니다.</span>}
            {snapshot ? <a className={`${buttonVariants({ variant: 'outline', size: 'sm' })} sm:ml-auto print:hidden`} data-slot="button" href={exportHref}>엑셀 다운로드</a> : null}
            {filters.importId ? <Link className="underline underline-offset-4" href={pgSettlementHref(filters, { importId: null, page: 1 })}>최신 수집 자료 조회</Link> : null}
          </div>
          {filters.mode === 'test' ? <p className={NOTE}>토스 테스트 환경은 정산 기록을 제공하지 않습니다. 실제 PG 정산 내역은 실거래 환경에서 조회합니다.</p> : null}
          {snapshot ? <>
            {/* 정산에서 제일 먼저 보는 숫자다. 승인·취소와 통화를 나눠 원문 그대로 보이고 순입금액으로 계산하지 않는다. */}
            {report.totals.length ? <section aria-label="기간 합계" className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground" data-pg-settlement-totals="">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-foreground">기간 합계 <span className="text-sm font-normal text-muted-foreground tabular-nums">{formatSalesDay(filters.startDate)} ~ {formatSalesDay(filters.endDate)} · 검색 조건 기준</span></h3>
                <p className={NOTE}>검색 결과 {report.pagination.total.toLocaleString('ko-KR')}건 · 승인과 취소를 따로 합산한 결제사 자료 값입니다. 실제 입금액은 은행 내역으로 확인하세요.</p>
              </div>
              <ConsoleGrid caption="기간 합계" configurable={false} columns={TOTAL_COLUMNS} rows={report.totals.map(row => ({ id: `${row.currency}:${row.kind}`, cells: [KIND_BADGE(row.kind), row.currency, row.count.toLocaleString('ko-KR'), STRONG_AMOUNT(row.amount), AMOUNT(row.feeAmount), STRONG_AMOUNT(row.payOutAmount)] }))} />
            </section> : null}
            {report.totals.length ? null : <p className={NOTE}>현재 검색 결과 {report.pagination.total.toLocaleString('ko-KR')}건 · 금액은 통화별 결제사 자료 값이며 수수료의 소수 자릿수를 그대로 보입니다.</p>}
            {/* 표도 합계처럼 제목이 있는 구역 안에 둔다 — 칸 바깥에 떠 있으면 어느 구역 표인지 알 수 없다. */}
            {filters.tab === 'daily' ? <ConsoleListCard><ConsoleGrid caption="일별 정산내역" preferencesKey="pg-settlement-daily" columns={DAILY_COLUMNS}
              emptyLabel="조건에 맞는 일별 정산 내역이 없습니다." rows={report.daily.map(row => ({ id: `${row.date}:${row.currency}:${row.kind}`, cells: [<span className="tabular-nums" key="date">{formatSalesDay(row.date)}</span>, KIND_BADGE(row.kind), row.currency, row.count.toLocaleString('ko-KR'), AMOUNT(row.amount), AMOUNT(row.feeAmount), AMOUNT(row.supplyAmount), AMOUNT(row.vat), AMOUNT(row.payOutAmount)] }))}><h3 className={TABLE_TITLE}>일별 정산내역</h3></ConsoleGrid></ConsoleListCard> : null}
            {filters.tab === 'transactions' ? <ConsoleListCard>
              <ConsoleGrid caption="건별 정산내역" preferencesKey="pg-settlement-transactions" columns={TRANSACTION_COLUMNS} emptyLabel="조건에 맞는 거래가 없습니다."
                rows={report.transactions.map(row => ({ id: row.id, cells: [
                  row.referenceId && row.purpose === 'order' ? <Link key="order" className="font-medium tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/orders/${row.referenceId}`}>{row.orderNumber}</Link> : row.orderNumber ?? '미연결',
                  <span key="kind" className="inline-flex flex-wrap items-center gap-1">{KIND_BADGE(row.kind)} {row.currency}</span>,
                  <span key="match" className="flex flex-col items-start gap-1"><AdminStatusBadge tone={statusTone('pgSettlementMatch', row.matchState)}>{PG_SETTLEMENT_MATCH_LABELS[row.matchState]}</AdminStatusBadge><small className={NOTE}>{row.matchReason ? MATCH_REASON[row.matchReason] ?? '추가 확인 필요' : '추가 확인 필요'}</small></span>,
                  <span key="date" className="flex flex-col tabular-nums">{formatSalesDay(row.soldDate)}<small className={NOTE}>{formatSalesDay(row.paidOutDate)}</small></span>, row.method, AMOUNT(row.amount), AMOUNT(row.payOutAmount), <TransactionDetails key="details" row={row} />,
                ] }))}><h3 className={TABLE_TITLE}>건별 정산내역</h3></ConsoleGrid>
              <ConsolePagination label="건별 정산내역 페이지" page={filters.page} pageSize={filters.pageSize} total={report.pagination.total} hrefForPage={page => pgSettlementHref(filters, { page })} />
            </ConsoleListCard> : null}
            {filters.tab === 'fees' ? <ConsoleListCard><ConsoleGrid caption="수수료 내역" preferencesKey="pg-settlement-fees" emptyLabel="조건에 맞는 수수료 내역이 없습니다."
              columns={[{ key: 'currency', label: '통화', width: '80px' }, { key: 'kind', label: '거래 구분', width: '100px' }, { key: 'type', label: '수수료 항목' }, { key: 'count', label: '거래수', align: 'end', width: '100px' }, { key: 'fee', label: '수수료 합계', align: 'end', width: '180px' }]}
              rows={report.fees.map(row => ({ id: `${row.currency}:${row.kind}:${row.type}`, cells: [row.currency, KIND_BADGE(row.kind), PG_SETTLEMENT_FEE_LABELS[row.type] ?? `수수료 (${row.type})`, row.count.toLocaleString('ko-KR'), AMOUNT(row.fee)] }))}><h3 className={TABLE_TITLE}>수수료 내역</h3></ConsoleGrid></ConsoleListCard> : null}
          </> : null}
          {report.jobs.length ? <details className="rounded-xl border bg-card px-4 py-3 text-card-foreground"><summary className="cursor-pointer font-medium">수집 이력 ({report.jobs.length}건)</summary><ul className="mt-3 flex flex-col divide-y border-t">{report.jobs.map(item => <li className="flex flex-wrap justify-between gap-x-5 gap-y-2 py-3" key={item.id}>
            <span className="flex flex-wrap items-center gap-2 tabular-nums">{formatOrderDateTime(item.startedAt)} · {item.recordCount.toLocaleString('ko-KR')}건 <AdminStatusBadge tone={item.state === 'complete' ? 'success' : item.state === 'failed' ? 'danger' : 'info'}>{item.state === 'complete' ? '완료' : item.state === 'failed' ? '중단' : '진행 중'}</AdminStatusBadge></span>
            {item.state === 'complete' ? <Link className="underline underline-offset-4" href={pgSettlementHref(filters, { importId: item.id, page: 1 })}>이 자료 조회</Link> : null}
          </li>)}</ul></details> : null}
        </>}
  </section>;
}
