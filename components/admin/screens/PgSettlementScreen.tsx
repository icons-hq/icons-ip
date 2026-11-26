import Link from 'next/link';
import { settlementAccountKey, type SettlementAccountOption } from '@/lib/settlements/accounts';
import { AdminStatusBadge } from '../console/AdminKit';
import { AdminHelpTip } from '../console/AdminHelpTip';
import { statusTone } from '@/lib/admin/status-tone';
import { PG_SETTLEMENTS_HELP } from '@/lib/admin/help/pg-settlements';
import { ADMIN_LIST_EXPORT_BUTTON_LABEL } from '@/lib/admin/list-export';
import { formatOrderDateTime } from '@/lib/orders';
import { ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '../console';
import { SalesFilterField, SalesSelect, SalesGuide, formatSalesDay } from '../sales/SalesConsole';
import { PgSettlementImportControl } from '../PgSettlementImportControl';
import { PgSettlementPeriodFields } from '../PgSettlementPeriodFields';
import { PG_SETTLEMENT_PATH, pgSettlementAccountName, pgSettlementHref, settlementJobLabel, type PgSettlementFilters } from '@/lib/settlements/console';
import { formatSettlementDecimal } from '@/lib/settlements/decimal';
import { PG_SETTLEMENT_KIND_LABELS, PG_SETTLEMENT_MATCH_LABELS, pgSettlementFeeLabel, pgSettlementMatchReason, type PgSettlementKind, type PgSettlementReport, type PgSettlementTransaction } from '@/lib/settlements/report';
import type { SettlementMode } from '@/lib/settlements/types';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const AMOUNT = (value: string) => <span className="tabular-nums">{formatSettlementDecimal(value)}</span>;
const STRONG_AMOUNT = (value: string) => <span className="font-semibold tabular-nums">{formatSettlementDecimal(value)}</span>;
/* 승인과 취소를 글자가 아니라 표시로도 구분한다 — 취소 줄이 승인 줄에 묻히지 않게 한다. */
const KIND_BADGE = (kind: PgSettlementKind) => <AdminStatusBadge tone={statusTone('pgSettlementKind', kind)}>{PG_SETTLEMENT_KIND_LABELS[kind]}</AdminStatusBadge>;
/* 결제사 정산 내역(템플릿 룩, ADR-0028). 조회 조건 카드·건수·표는 판매관리 공용 조각과 같은 모양이다. */
const TAB_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
const DETAIL_ROW = 'grid grid-cols-[minmax(5.3rem,1fr)_minmax(6.25rem,1.4fr)] gap-2.5';
const DETAIL_TERM = 'text-muted-foreground';
const DETAIL_VALUE = 'min-w-0 wrap-anywhere';
const NOTE = 'text-xs leading-relaxed text-muted-foreground';
const TABLE_TITLE = 'text-base font-semibold text-foreground';
const DAILY_COLUMNS: ConsoleGridColumn[] = [
  { key: 'date', label: '기준일', width: '115px' }, { key: 'kind', label: '거래 구분', width: '90px' }, { key: 'currency', label: '통화', width: '75px' },
  { key: 'count', label: '거래수', align: 'end', width: '80px' }, { key: 'amount', label: '거래금액', align: 'end', width: '145px' },
  { key: 'fee', label: '수수료', align: 'end', width: '140px' }, { key: 'supply', label: '수수료 공급가', align: 'end', width: '130px' },
  { key: 'vat', label: '수수료 부가세', align: 'end', width: '130px' }, { key: 'payout', label: '지급액', align: 'end', width: '150px' },
];
/* 1440 화면(표 폭 약 1,100px)에 금액 열까지 들어오게 나눈다. 수수료 상세는 펼쳐서 보므로 접힌 폭만 잡는다. */
const TRANSACTION_COLUMNS: ConsoleGridColumn[] = [
  { key: 'order', label: '주문번호', width: '170px' }, { key: 'kind', label: '거래 구분 / 통화', width: '112px' },
  { key: 'match', label: '비교 결과', width: '168px' }, { key: 'date', label: '정산 매출일 / 지급일', width: '132px' },
  { key: 'method', label: '결제수단', width: '84px' }, { key: 'amount', label: '거래금액', align: 'end', width: '116px' },
  { key: 'payout', label: '지급액', align: 'end', width: '116px' }, { key: 'detail', label: '수수료·거래 상세', width: '220px' },
];
const TOTAL_COLUMNS: ConsoleGridColumn[] = [
  { key: 'kind', label: '거래 구분', width: '100px' }, { key: 'currency', label: '통화', width: '80px' }, { key: 'count', label: '거래수', align: 'end', width: '90px' },
  { key: 'amount', label: '거래금액', align: 'end' }, { key: 'fee', label: '수수료', align: 'end' }, { key: 'payout', label: '지급액', align: 'end' },
];
/* 비교한 이유는 표의 '비교 결과' 칸에 이미 보이므로 펼침에는 되풀이하지 않는다. */
function TransactionDetails({ row }: { row: PgSettlementTransaction }) {
  return <details className="min-w-50 text-xs"><summary className="cursor-pointer underline-offset-4 hover:underline">상세</summary><dl className="mt-3 grid gap-2">
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>승인 시각 (KST)</dt><dd className={DETAIL_VALUE}>{formatOrderDateTime(row.approvedAt)}</dd></div>
    {row.canceledAt ? <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>취소 시각 (KST)</dt><dd className={DETAIL_VALUE}>{formatOrderDateTime(row.canceledAt)}</dd></div> : null}
    {row.cancelAmount !== null ? <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>취소금액</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.cancelAmount)}</dd></div> : null}
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>할부 수수료</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.interestFee)}</dd></div>
    {row.fees.map((fee, index) => <div className={DETAIL_ROW} key={`${fee.type}-${index}`}><dt className={DETAIL_TERM}>{pgSettlementFeeLabel(fee.type)}</dt><dd className={DETAIL_VALUE}>{AMOUNT(fee.fee)}</dd></div>)}
    <div className={DETAIL_ROW}><dt className={DETAIL_TERM}>수수료 공급가</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.supplyAmount)}</dd></div><div className={DETAIL_ROW}><dt className={DETAIL_TERM}>수수료 부가세</dt><dd className={DETAIL_VALUE}>{AMOUNT(row.vat)}</dd></div>
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
  /* 토스 테스트 환경에는 정산 기록이 없어 운영자가 할 일이 없다. 테스트로 보고 있거나 연결이 테스트일 때만 자료 구분을 고르게 하고, 그 밖에는 지금 값을 그대로 보낸다. */
  const showMode = filters.mode === 'test' || connection.mode === 'test';
  /* 통화는 받은 자료에 있는 것만 고른다. 하나뿐이면 고를 것이 없어 칸을 두지 않고, 이미 걸어 둔 통화는 풀 수 있게 남긴다. */
  const currencies = Array.from(new Set([...(report?.totals.map(row => row.currency) ?? []), ...(filters.currency ? [filters.currency] : [])])).sort();
  const showCurrency = currencies.length > 1 || Boolean(filters.currency);
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-pg-settlements="">
    {/* 조회 단위와 메뉴설명을 한 줄에 두어 합계와 표가 첫 화면에 더 들어오게 한다. */}
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <nav className="inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-0.5" aria-label="정산 조회 단위">
        {([['daily', '일별 정산 내역'], ['transactions', '건별 정산 내역'], ['fees', '수수료 내역']] as const).map(([tab, label]) =>
          <Link className={TAB_CLASS} key={tab} aria-current={filters.tab === tab ? 'page' : undefined} href={pgSettlementHref(filters, { tab, page: 1 })}>{label}</Link>)}
      </nav>
      <div className="min-w-0 flex-1 basis-80">
        <SalesGuide title="결제사(토스페이먼츠)에서 가져온 정산 자료와 엑스스퀘어 결제·환불 기록을 맞춰 봅니다.">
          <p>정산 매출일·지급일은 결제사가 정한 날짜입니다. 비교 결과는 자료를 가져온 시점의 우리 결제·환불 기록 기준이라, 그 뒤에 기록이 바뀌었다면 다시 가져와야 새로 비교합니다.</p>
        </SalesGuide>
      </div>
    </div>
    <form action={PG_SETTLEMENT_PATH} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground print:hidden" data-sales-filters="" method="get" key={href}>
      <input type="hidden" name="tab" value={filters.tab} />
      {filters.importId ? <input type="hidden" name="import" value={filters.importId} /> : null}
      {showMode ? null : <input type="hidden" name="mode" value={filters.mode} />}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <SalesFilterField label="정산 계정" htmlFor="pg-settlement-account"><SalesSelect id="pg-settlement-account" name="account" value={filters.account ?? ''}
          options={[{ value: '', label: '계정을 선택해주세요' }, ...accounts.filter(account => account.mode === filters.mode).map(account => ({ value: settlementAccountKey(account), label: pgSettlementAccountName(account, accounts) }))]} /></SalesFilterField>
        <SalesFilterField label="조회기간" htmlFor="pg-settlement-date-field">
          <SalesSelect id="pg-settlement-date-field" name="dateField" value={filters.dateType} options={[{ value: 'paidOutDate', label: '정산 지급일' }, { value: 'soldDate', label: '정산 매출일' }]} />
          <PgSettlementPeriodFields from={filters.startDate} to={filters.endDate} />
        </SalesFilterField>
        <SalesFilterField label="상세조건" htmlFor="pg-settlement-query">
          <Input className="w-60 max-w-full" type="search" id="pg-settlement-query" name="query" maxLength={100} defaultValue={filters.query} placeholder="엑스스퀘어 주문번호" />
          <SalesSelect name="kind" label="거래 구분" value={filters.kind} options={[{ value: 'all', label: '거래 전체' }, { value: 'approval', label: '승인' }, { value: 'cancel', label: '취소' }]} />
          <SalesSelect name="match" label="비교 결과" value={filters.match} options={[{ value: 'all', label: '비교 결과 전체' }, { value: 'matched', label: PG_SETTLEMENT_MATCH_LABELS.matched }, { value: 'unlinked', label: PG_SETTLEMENT_MATCH_LABELS.unlinked }, { value: 'mismatch', label: PG_SETTLEMENT_MATCH_LABELS.mismatch }]} />
        </SalesFilterField>
        {showCurrency ? <SalesFilterField label="통화" htmlFor="pg-settlement-currency">
          <SalesSelect id="pg-settlement-currency" name="currency" value={filters.currency} options={[{ value: '', label: '통화 전체' }, ...currencies.map(code => ({ value: code, label: code }))]} />
        </SalesFilterField> : null}
        <SalesFilterField label="목록 수" htmlFor="pg-settlement-page-size">
          <SalesSelect id="pg-settlement-page-size" name="pageSize" value={String(filters.pageSize)} options={[20, 50, 100].map(size => ({ value: String(size), label: `${size}개씩 보기` }))} />
        </SalesFilterField>
        {showMode ? <SalesFilterField label="자료 구분" htmlFor="pg-settlement-mode">
          <SalesSelect id="pg-settlement-mode" name="mode" value={filters.mode} options={[{ value: 'live', label: '실거래 자료' }, { value: 'test', label: '테스트 자료' }]} />
        </SalesFilterField> : null}
        {/* 조회 버튼을 입력과 같은 줄 끝에 둔다 — 버튼만의 줄이 처리할 목록을 한 줄씩 밀어낸다. */}
        <div className="ml-auto flex items-center gap-2 self-end"><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={PG_SETTLEMENT_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
      </div>
    </form>
    {filters.rangeError ? <Alert variant="destructive"><AlertDescription className="text-destructive">{filters.rangeError}</AlertDescription></Alert>
      : !report ? <Alert variant="destructive"><AlertDescription className="text-destructive">정산 자료를 불러오지 못했습니다. 잠시 뒤 다시 검색해 보세요. 계속 안 되면 개발 담당자에게 알려 주세요.</AlertDescription></Alert>
        : <>
          <PgSettlementImportControl key={`${filters.account}:${filters.mode}:${filters.dateType}:${filters.startDate}:${filters.endDate}`} query={collectionQuery} enabled={connection.enabled} connectedMode={connection.mode} initialJob={job} operationId={operationId} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-card-foreground" data-pg-settlement-snapshot="">
            {/* 연결이 꺼져 있으면 지금 가져온 게 아니라 전에 받아 둔 자료다. 바로 위 주의 상자와 부딪히지 않게 초록 '가져옴'으로 부르지 않는다. */}
            <AdminStatusBadge tone={!snapshot ? 'warning' : connection.enabled ? 'success' : 'neutral'}>{report.coverage === 'uncollected' ? '아직 안 가져옴' : `${connection.enabled ? '가져옴' : '저장된 자료'}${report.coverage === 'empty' ? ' · 0건' : ''}`}</AdminStatusBadge>
            <strong className="font-medium">{filters.mode === 'live' ? '실거래' : '테스트'} · 토스페이먼츠{snapshot ? ` · ${pgSettlementAccountName(snapshot, accounts)}` : ''}</strong>
            {snapshot ? <span className="text-muted-foreground tabular-nums">가져온 시각 (KST) {snapshot.completedAt ? formatOrderDateTime(snapshot.completedAt) : ''} · 전체 {snapshot.recordCount.toLocaleString('ko-KR')}건</span> : <span className="text-muted-foreground">이 기간에 가져온 자료가 없습니다.</span>}
            {snapshot ? <a className={`${buttonVariants({ variant: 'outline', size: 'sm' })} sm:ml-auto print:hidden`} data-slot="button" href={exportHref}>{ADMIN_LIST_EXPORT_BUTTON_LABEL}</a> : null}
            {filters.importId ? <Link className="underline underline-offset-4" href={pgSettlementHref(filters, { importId: null, page: 1 })}>가장 최근에 가져온 자료 보기</Link> : null}
          </div>
          {filters.mode === 'test' ? <p className={NOTE}>토스 테스트 환경에는 정산 기록이 없습니다. 실제 정산 내역은 자료 구분을 실거래로 바꿔 확인합니다.</p> : null}
          {snapshot ? <>
            {/* 정산에서 제일 먼저 보는 숫자다. 승인·취소와 통화를 나눠 원문 그대로 보이고 순입금액으로 계산하지 않는다. */}
            {report.totals.length ? <section aria-label="기간 합계" className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground" data-pg-settlement-totals="">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <div className="flex flex-wrap items-center gap-x-1.5">
                  <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-foreground">기간 합계 <span className="text-sm font-normal text-muted-foreground tabular-nums">{formatSalesDay(filters.startDate)} ~ {formatSalesDay(filters.endDate)} · 검색 조건 기준</span></h3>
                  {/* 표 머리글은 글자만 받아 열 이름 옆에는 달 수 없다 — 지급액이 처음 나오는 이 제목 옆에 둔다. */}
                  <AdminHelpTip help={PG_SETTLEMENTS_HELP.payout} label="지급액" />
                </div>
                <p className={NOTE}>검색 결과 {report.pagination.total.toLocaleString('ko-KR')}건</p>
              </div>
              <ConsoleGrid caption="기간 합계" configurable={false} columns={TOTAL_COLUMNS} rows={report.totals.map(row => ({ id: `${row.currency}:${row.kind}`, cells: [KIND_BADGE(row.kind), row.currency, row.count.toLocaleString('ko-KR'), STRONG_AMOUNT(row.amount), AMOUNT(row.feeAmount), STRONG_AMOUNT(row.payOutAmount)] }))} />
            </section> : null}
            {report.totals.length ? null : <p className={NOTE}>검색 결과 {report.pagination.total.toLocaleString('ko-KR')}건</p>}
            {/* 표도 합계처럼 제목이 있는 구역 안에 둔다 — 칸 바깥에 떠 있으면 어느 구역 표인지 알 수 없다. */}
            {filters.tab === 'daily' ? <ConsoleListCard><ConsoleGrid caption="일별 정산 내역" preferencesKey="pg-settlement-daily" columns={DAILY_COLUMNS}
              emptyLabel="조건에 맞는 일별 정산 내역이 없습니다." rows={report.daily.map(row => ({ id: `${row.date}:${row.currency}:${row.kind}`, cells: [<span className="tabular-nums" key="date">{formatSalesDay(row.date)}</span>, KIND_BADGE(row.kind), row.currency, row.count.toLocaleString('ko-KR'), AMOUNT(row.amount), AMOUNT(row.feeAmount), AMOUNT(row.supplyAmount), AMOUNT(row.vat), AMOUNT(row.payOutAmount)] }))}><h3 className={TABLE_TITLE}>일별 정산 내역</h3></ConsoleGrid></ConsoleListCard> : null}
            {filters.tab === 'transactions' ? <ConsoleListCard>
              <ConsoleGrid caption="건별 정산 내역" preferencesKey="pg-settlement-transactions" columns={TRANSACTION_COLUMNS} emptyLabel="조건에 맞는 거래가 없습니다."
                rows={report.transactions.map(row => ({ id: row.id, cells: [
                  row.referenceId && row.purpose === 'order' ? <Link key="order" className="font-medium tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/orders/${row.referenceId}`}>{row.orderNumber}</Link> : row.orderNumber ?? '-',
                  <span key="kind" className="inline-flex flex-wrap items-center gap-1">{KIND_BADGE(row.kind)} {row.currency}</span>,
                  <span key="match" className="flex flex-col items-start gap-1"><AdminStatusBadge tone={statusTone('pgSettlementMatch', row.matchState)}>{PG_SETTLEMENT_MATCH_LABELS[row.matchState]}</AdminStatusBadge><small className={NOTE}>{pgSettlementMatchReason(row.matchReason)}</small></span>,
                  <span key="date" className="flex flex-col tabular-nums">{formatSalesDay(row.soldDate)}<small className={NOTE}>{formatSalesDay(row.paidOutDate)}</small></span>, row.method, AMOUNT(row.amount), AMOUNT(row.payOutAmount), <TransactionDetails key="details" row={row} />,
                ] }))}><h3 className={TABLE_TITLE}>건별 정산 내역</h3></ConsoleGrid>
              <ConsolePagination label="건별 정산 내역 페이지" page={filters.page} pageSize={filters.pageSize} total={report.pagination.total} hrefForPage={page => pgSettlementHref(filters, { page })} />
            </ConsoleListCard> : null}
            {filters.tab === 'fees' ? <ConsoleListCard><ConsoleGrid caption="수수료 내역" preferencesKey="pg-settlement-fees" emptyLabel="조건에 맞는 수수료 내역이 없습니다."
              columns={[{ key: 'currency', label: '통화', width: '80px' }, { key: 'kind', label: '거래 구분', width: '100px' }, { key: 'type', label: '수수료 항목' }, { key: 'count', label: '거래수', align: 'end', width: '100px' }, { key: 'fee', label: '수수료 합계', align: 'end', width: '180px' }]}
              rows={report.fees.map(row => ({ id: `${row.currency}:${row.kind}:${row.type}`, cells: [row.currency, KIND_BADGE(row.kind), pgSettlementFeeLabel(row.type), row.count.toLocaleString('ko-KR'), AMOUNT(row.fee)] }))}><h3 className={TABLE_TITLE}>수수료 내역</h3></ConsoleGrid></ConsoleListCard> : null}
          </> : null}
          {/* 내가 시작한 가져오기만 보인다(같은 조건의 최근 10건). 끝난 자료는 이 목록에서 다시 볼 수 있다. */}
          {report.jobs.length ? <details className="rounded-xl border bg-card px-4 py-3 text-card-foreground"><summary className="cursor-pointer font-medium">내가 가져온 기록 ({report.jobs.length}건)</summary><ul className="mt-3 flex flex-col divide-y border-t">{report.jobs.map(item => <li className="flex flex-wrap justify-between gap-x-5 gap-y-2 py-3" key={item.id}>
            <span className="flex flex-wrap items-center gap-2 tabular-nums">{formatOrderDateTime(item.startedAt)} · {item.recordCount.toLocaleString('ko-KR')}건 <AdminStatusBadge tone={item.state === 'complete' ? 'success' : item.state === 'failed' ? 'danger' : 'info'}>{item.state === 'complete' || item.state === 'failed' ? settlementJobLabel(item) : '진행 중'}</AdminStatusBadge></span>
            {item.state === 'complete' ? <Link className="underline underline-offset-4" href={pgSettlementHref(filters, { importId: item.id, page: 1 })}>이 자료 보기</Link> : null}
          </li>)}</ul></details> : null}
        </>}
  </section>;
}
