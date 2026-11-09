import Link from 'next/link';
import { Download } from 'lucide-react';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { SalesFilterPanel, SalesFilterField, SalesSelect, SalesGuide } from '@/components/admin/sales/SalesConsole';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { FIELD_HINT, RESULT_HEADING, SEGMENTED, SEGMENT_LINK } from '@/components/admin/settings-kit';
import { STORE_CREDIT_KINDS, storeCreditConsoleHref, type StoreCreditConsoleData } from '@/lib/admin/store-credit-console';
import { storeCreditEntryLabel, type StoreCreditPolicyRecord } from '@/lib/store-credits';
import { formatOrderDateTime } from '@/lib/orders';
import { StoreCreditBatchInspect, StoreCreditRegisterArea } from './StoreCreditBatchForm';
const STATUS = { prepared: '확인 대기', completed: '지급 완료', failed: '전체 실패' };
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const CELL_STACK = 'flex min-w-0 flex-col gap-0.5';
const CELL_SUB = `${FIELD_HINT} [overflow-wrap:anywhere]`;
const CELL_LINK = 'font-medium underline-offset-4 hover:underline';
export function StoreCreditConsoleScreen({ data, policy }: { data: StoreCreditConsoleData; policy: StoreCreditPolicyRecord }) {
  const { filters } = data; const ledger = filters.mode === 'ledger'; const currentHref = storeCreditConsoleHref(filters);
  /* 건수 집계가 따로 없어 이 페이지의 줄만 센다 — 지급 전 확인이 표 아래쪽에 묻히지 않게 표 위에서 말한다. */
  const preparedOnPage = !ledger && filters.kind !== 'prepared' ? data.rows.filter(row => row.kind === 'prepared').length : 0;
  const tabs = <nav aria-label="적립금 관리 메뉴" className={SEGMENTED}><Link aria-current={!ledger ? 'page' : undefined} className={SEGMENT_LINK} href={storeCreditConsoleHref({ ...filters, mode: 'batches', kind: '', page: 1 })}>적립금 지급관리</Link><Link aria-current={ledger ? 'page' : undefined} className={SEGMENT_LINK} href={storeCreditConsoleHref({ ...filters, mode: 'ledger', kind: '', page: 1 })}>적립금 내역</Link><Link className={SEGMENT_LINK} href="/admin/settings/store-credits">정책 설정</Link></nav>;
  const columns: ConsoleGridColumn[] = ledger ? [
    { key: 'date', label: '발생일시', width: '155px', required: true },{ key: 'kind', label: '내역 구분', width: '155px' },
    { key: 'customer', label: '고객', width: '220px', required: true },{ key: 'amount', label: '금액', width: '115px' },
    { key: 'balance', label: '잔액 변동', width: '165px' },{ key: 'reason', label: '사유', width: '220px' },
    { key: 'order', label: '주문번호', width: '170px' },{ key: 'expiry', label: '만료 일시', width: '155px' },{ key: 'batch', label: '지급 작업', width: '180px' },
  ] : [
    { key: 'date', label: '등록일시', width: '146px', required: true },{ key: 'kind', label: '처리상태', width: '96px' },
    { key: 'reason', label: '지급 사유 / 목적', width: '200px', required: true },{ key: 'count', label: '대상 / 성공 / 실패', width: '120px' },
    { key: 'amount', label: '1인 지급액', width: '96px' },{ key: 'total', label: '총 발급 예정액', width: '112px' },
    { key: 'expiry', label: '만료 일시', width: '146px' },{ key: 'detail', label: '저장된 결과', width: '150px', required: true },
  ];
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="store-credits">
    <SalesGuide title="운영 적립금을 지급하고 실제 원장 내역을 확인합니다."><p>관리자만 지급할 수 있습니다. 최대 1,000명을 먼저 검증하고 대상 수·금액을 확인한 뒤 일괄 지급합니다. 기존 정책의 보유 상한·유효기간과 회수 적립금 상계를 적용합니다.</p><p>한 명이라도 처리 조건이 달라지면 전체 지급을 중단합니다. 저장된 작업 ID로 결과를 조회하거나 재시도해 중복 지급을 방지합니다.</p></SalesGuide>
    {ledger ? tabs : <StoreCreditRegisterArea enabled={policy.enabled} tabs={tabs} validityDays={policy.validityDays} />}
    <SalesFilterPanel currentHref={currentHref} resetHref={ledger ? '/admin/sales/store-credits?mode=ledger' : undefined} id="store-credit-console" hiddenFieldExclusions={['kind','pageSize']}
      date={{ from: filters.from, to: filters.to, field: 'created', options: [{ value: 'created', label: ledger ? '발생일' : '등록일' }] }} search={{ value: filters.query, placeholder: '고객명 · 정확한 이메일 · 고객/주문/작업 ID · 사유' }}>
      <SalesFilterField label={ledger ? '내역 구분' : '처리상태'} htmlFor="credit-kind"><SalesSelect id="credit-kind" name="kind" value={filters.kind} options={[{ value: '', label: '전체' },...(ledger ? STORE_CREDIT_KINDS.map(value => ({ value,label: storeCreditEntryLabel(value) })) : Object.entries(STATUS).map(([value,label]) => ({ value,label })))]} /></SalesFilterField>
      <SalesFilterField label="목록 수" htmlFor="credit-page-size"><SalesSelect id="credit-page-size" name="pageSize" value={String(filters.pageSize)} options={[20,50,100].map(value => ({ value:String(value),label:`${value}개씩 보기` }))} /></SalesFilterField>
    </SalesFilterPanel>
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card pb-3 text-card-foreground" data-store-credit-results="">
      <div className={RESULT_HEADING}><h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-medium">목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{data.total.toLocaleString('ko-KR')}</strong>건)</span>{preparedOnPage ? <Link className="inline-flex" href={storeCreditConsoleHref({ ...filters, kind: 'prepared', page: 1 })}><AdminStatusBadge tone="warning">이 페이지 확인 대기 {preparedOnPage}건</AdminStatusBadge></Link> : null}</h2><span className="text-xs text-muted-foreground">최근 발생순</span></div>
      <ConsoleGrid caption={ledger ? '전체 고객 적립금 원장' : '적립금 지급 작업 목록'} className="px-4" preferencesKey={`store-credits-${filters.mode}`} columns={columns} emptyLabel="조회 조건에 맞는 적립금 내역이 없습니다." rows={data.rows.map(row => ({ id: `${row.source}-${row.id}`, cells: ledger ? [
        formatOrderDateTime(row.createdAt),storeCreditEntryLabel(row.kind),<div className={CELL_STACK} key="customer">{row.userId ? <Link className={CELL_LINK} href={`/admin/customers/${row.userId}/store-credits`}>{row.nickname || '고객별 내역'}</Link> : '—'}<small className={CELL_SUB}>{row.maskedEmail}</small><small className={CELL_SUB}>{row.userId}</small></div>,won(row.amount),
        <div className={CELL_STACK} key="balance">사용 가능 {won(row.availableDelta ?? 0)}<small className={CELL_SUB}>사용 대기 {won(row.reservedDelta ?? 0)}</small><small className={CELL_SUB}>회수 대기 {won(row.debtDelta ?? 0)}</small></div>,row.reason || '—',row.orderId ? <Link key="order" className={`${CELL_LINK} tabular-nums`} href={`/admin/sales/orders/${row.orderId}`}>{row.orderId}</Link> : '—',row.expiresAt ? formatOrderDateTime(row.expiresAt) : '—',row.batchId ? <StoreCreditBatchInspect key="batch" id={row.batchId} /> : '—',
      ] : [formatOrderDateTime(row.createdAt),<AdminStatusBadge key="status" tone={statusTone('creditBatch', row.kind)}>{STATUS[row.kind as keyof typeof STATUS] ?? row.kind}</AdminStatusBadge>,<div className={CELL_STACK} key="reason">{row.reason}<small className={CELL_SUB}>{row.source === 'individual' ? '기존 고객별 지급' : row.purpose === 'promotion' ? '구매 프로모션' : '일반 운영 지급'}</small></div>,`${row.recipients} / ${row.completed} / ${row.kind === 'failed' ? row.recipients : 0}`,won(row.amount),won(row.gross),row.expiresAt ? formatOrderDateTime(row.expiresAt) : '—',row.batchId ? <StoreCreditBatchInspect attention={row.kind === 'prepared'} key="detail" id={row.batchId} /> : row.userId ? <Link key="customer" className={CELL_LINK} href={`/admin/customers/${row.userId}/store-credits`}>고객별 지급 내역</Link> : '—'] }))}>
        {/* 내려받기와 조회항목 설정을 한 줄에 둔다 — 표 위에 줄이 겹겹이 쌓이지 않게. */}
        <form action="/api/admin/store-credit-workbook" className="flex flex-wrap items-center justify-between gap-3" method="get">
          {Object.entries({mode:filters.mode,query:filters.query,from:filters.from,to:filters.to,kind:filters.kind}).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <label className="flex min-w-0 flex-1 basis-72 items-start gap-2 text-xs text-muted-foreground"><input className="mt-0.5" type="checkbox" name="privacyConfirmed" value="yes" required />고객·금액 내역이 포함된 암호화되지 않은 파일의 업무용 보관·삭제 책임을 확인합니다.</label>
          <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="submit" disabled={data.total > 10000}><Download aria-hidden="true" />검색 결과 엑셀{data.total > 10000 ? ' · 10,000행 초과' : ''}</button>
        </form>
      </ConsoleGrid>
      <ConsolePagination className="px-4" label="적립금 내역 페이지" page={filters.page} pageSize={filters.pageSize} total={data.total} hrefForPage={page => storeCreditConsoleHref({ ...filters,page })} />
    </section>
  </div>;
}
